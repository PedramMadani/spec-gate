import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormatsModule from 'ajv-formats';

// ajv-formats ships CJS; under NodeNext the callable lives on .default in ESM.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => Ajv2020;
import type { GateConfig, Profile } from './types.js';

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'record.schema.json');
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
const validateSchema = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));

export class RecordError extends Error {}

/** The schema is the contract the artifact makes to whoever reads it later. A record
 *  that does not satisfy it is not written at all, because a malformed record that
 *  claims a decision is worse than no record. */
export function validateRecord(record: Record<string, unknown>): void {
  if (!validateSchema(record)) {
    const errs = ((validateSchema.errors ?? []) as ErrorObject[]).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new RecordError(`record does not satisfy the schema: ${errs}`);
  }
}

export const SCHEMA_VERSION = '0.1.0';

export interface ScoredDimension {
  id: string;
  coverage: number;
  method: 'deterministic' | 'model';
  evidence: string | null;
  questions?: { ask: string; answer: string | null; answered_by: string | null }[];
}

export interface RecordInput {
  request: string;
  profile: Profile;
  threshold: number;
  sufficiency: number;
  dimensions: ScoredDimension[];
  constraints?: string[];
  assumptions?: string[];
  scorer: { type: 'deterministic+declared' | 'external' | 'deterministic-only'; model?: string | null; independent: boolean };
  decision: { verdict: 'proceed' | 'block' | 'override'; override?: { reason: string; by: string; at: string } };
  caller?: { client?: string; repo?: string; ref?: string; session?: string };
}

export interface WrittenRecord {
  path: string;
  markdownPath: string;
  hash: string;
  id: string;
}

/** An override with no reason is the thing this whole tool exists to prevent, so it
 *  is rejected here rather than written and reviewed later. */
export function buildRecord(input: RecordInput): Record<string, unknown> {
  if (input.decision.verdict === 'override' && !input.decision.override?.reason?.trim())
    throw new RecordError('an override requires a written reason');

  const created = new Date().toISOString();
  const id = recordId(input.request, created);

  const record: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    id,
    created_at: created,
    request: input.request,
    ...(input.caller ? { caller: input.caller } : {}),
    profile: { id: input.profile.id, version: input.profile.version, source: input.profile.source },
    threshold: input.threshold,
    sufficiency: round(input.sufficiency),
    dimensions: input.dimensions.map((d) => ({
      id: d.id,
      coverage: d.coverage,
      method: d.method,
      evidence: d.evidence,
      ...(d.questions?.length ? { questions: d.questions } : {}),
    })),
    ...(input.constraints?.length ? { constraints: input.constraints } : {}),
    ...(input.assumptions?.length ? { assumptions: input.assumptions } : {}),
    scorer: { type: input.scorer.type, model: input.scorer.model ?? null, independent: input.scorer.independent },
    decision: input.decision,
  };
  const complete = { ...record, hash: hashOf(record) };
  validateRecord(complete);
  return complete;
}

/** The hash covers the record without the hash field, so it can be recomputed by
 *  anyone holding the file. Canonical key order, or the same record hashes twice. */
export function hashOf(record: Record<string, unknown>): string {
  const { hash: _drop, ...rest } = record as Record<string, unknown> & { hash?: string };
  return 'sha256:' + createHash('sha256').update(canonical(rest)).digest('hex');
}

export function verifyRecord(record: Record<string, unknown>): boolean {
  return typeof record.hash === 'string' && record.hash === hashOf(record);
}

export function writeRecord(config: GateConfig, input: RecordInput): WrittenRecord {
  const record = buildRecord(input);
  const dir = resolve(config.root, config.recordsDir);
  mkdirSync(dir, { recursive: true });

  const id = record.id as string;
  const path = join(dir, `${id}.json`);
  const markdownPath = join(dir, `${id}.md`);
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
  writeFileSync(markdownPath, renderMarkdown(record));
  return { path, markdownPath, hash: record.hash as string, id };
}

/** The sibling exists so the person who has to review the decision is not required
 *  to read JSON. It is a view, never the source of truth. */
export function renderMarkdown(r: Record<string, unknown>): string {
  const d = r.decision as RecordInput['decision'];
  const scorer = r.scorer as RecordInput['scorer'];
  const profile = r.profile as { id: string; version: string };
  const verdict = d.verdict === 'override' ? 'Overridden' : d.verdict === 'proceed' ? 'Proceeded' : 'Blocked';
  const lines: string[] = [
    `### ${String(r.request).split('\n')[0]}`,
    '',
    `**${verdict}** at ${r.sufficiency} against a threshold of ${r.threshold} · profile \`${profile.id}@${profile.version}\` · scorer: ${scorer.type} (${scorer.independent ? 'independent' : 'not independent'})`,
    '',
    '| Dimension | Coverage | Scored by | Evidence |',
    '|---|---|---|---|',
  ];
  for (const dim of r.dimensions as ScoredDimension[])
    lines.push(`| ${dim.id} | ${dim.coverage} | ${dim.method} | ${dim.evidence ?? '—'} |`);

  const constraints = (r.constraints as string[] | undefined) ?? [];
  const assumptions = (r.assumptions as string[] | undefined) ?? [];
  if (constraints.length) lines.push('', '**Constraints**', ...constraints.map((c) => `- ${c}`));
  if (assumptions.length) lines.push('', '**Assumptions**  *(not established, carried anyway)*', ...assumptions.map((a) => `- ${a}`));
  if (d.override) lines.push('', `**Override** by ${d.override.by} at ${d.override.at}`, '', `> ${d.override.reason}`);
  lines.push('', `\`${r.id}\` · ${r.created_at} · \`${r.hash}\``, '');
  return lines.join('\n');
}

/** Most recent authorising record for a repo, used by the pre-work hook. A blocked
 *  record authorises nothing, which is the point of storing it. */
export function latestAuthorisation(config: GateConfig, session?: string): Record<string, unknown> | null {
  const dir = resolve(config.root, config.recordsDir);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
      const verdict = (r.decision as { verdict?: string } | undefined)?.verdict;
      if (verdict !== 'proceed' && verdict !== 'override') continue;
      if (!verifyRecord(r)) continue; // an edited record authorises nothing
      if (session && (r.caller as { session?: string } | undefined)?.session !== session) continue;
      return r;
    } catch {
      continue;
    }
  }
  return null;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

const recordId = (request: string, created: string): string => {
  const slug = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'request';
  return `${created.slice(0, 10)}-${slug}-${createHash('sha256').update(request + created).digest('hex').slice(0, 6)}`;
};

const canonical = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
};
