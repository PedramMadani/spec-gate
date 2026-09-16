import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { COVERAGE_VALUES, type Check, type Coverage, type Dimension, type Profile } from './types.js';

const BUILTIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'profiles');

export class ProfileError extends Error {}

/** A malformed profile must fail loudly. Scoring everything zero because a key was
 *  misspelled would block every request and look like the gate working. */
export function loadProfile(nameOrPath: string, from = process.cwd()): Profile {
  const path = resolveProfilePath(nameOrPath, from);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ProfileError(`profile ${path} is not valid YAML: ${(e as Error).message}`);
  }
  return validate(raw, path);
}

function resolveProfilePath(nameOrPath: string, from: string): string {
  const candidates = nameOrPath.endsWith('.yaml') || nameOrPath.endsWith('.yml')
    ? [isAbsolute(nameOrPath) ? nameOrPath : resolve(from, nameOrPath)]
    : [join(BUILTIN_DIR, `${nameOrPath}.yaml`), resolve(from, `${nameOrPath}.yaml`)];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new ProfileError(`profile "${nameOrPath}" not found (looked in ${candidates.join(', ')})`);
  return found;
}

function validate(raw: unknown, source: string): Profile {
  if (!raw || typeof raw !== 'object') throw new ProfileError(`profile ${source} is empty`);
  const p = raw as Record<string, unknown>;
  const id = str(p.id, 'id', source);
  const version = str(p.version, 'version', source);
  const threshold = num(p.threshold, 'threshold', source);
  if (threshold <= 0 || threshold > 1) throw new ProfileError(`profile ${source}: threshold must be in (0, 1]`);

  if (!Array.isArray(p.dimensions) || p.dimensions.length === 0)
    throw new ProfileError(`profile ${source}: needs at least one dimension`);

  const dimensions = p.dimensions.map((d, i) => dimension(d, `${source} dimension ${i}`));
  const ids = new Set<string>();
  for (const d of dimensions) {
    if (ids.has(d.id)) throw new ProfileError(`profile ${source}: duplicate dimension id "${d.id}"`);
    ids.add(d.id);
  }
  const sum = dimensions.reduce((a, d) => a + d.weight, 0);
  // Weights are a share of one decision. Anything else means the threshold no
  // longer means what the profile says it means.
  if (Math.abs(sum - 1) > 1e-6)
    throw new ProfileError(`profile ${source}: dimension weights sum to ${sum.toFixed(3)}, expected 1`);

  return { id, version, threshold, rubric: (p.rubric ?? {}) as Record<string, string>, dimensions, source };
}

function dimension(raw: unknown, where: string): Dimension {
  if (!raw || typeof raw !== 'object') throw new ProfileError(`${where}: not an object`);
  const d = raw as Record<string, unknown>;
  return {
    id: str(d.id, 'id', where),
    weight: num(d.weight, 'weight', where),
    question: str(d.question, 'question', where),
    why: typeof d.why === 'string' ? d.why : undefined,
    checks: Array.isArray(d.checks) ? d.checks.map((c, i) => check(c, `${where} check ${i}`)) : [],
  };
}

function check(raw: unknown, where: string): Check {
  if (!raw || typeof raw !== 'object') throw new ProfileError(`${where}: not an object`);
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'regex') throw new ProfileError(`${where}: unsupported check kind "${String(c.kind)}"`);
  const pattern = str(c.pattern, 'pattern', where);
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new ProfileError(`${where}: invalid regex: ${(e as Error).message}`);
  }
  return { id: str(c.id, 'id', where), kind: 'regex', pattern, on_match: coverage(c.on_match, where), on_miss: coverage(c.on_miss, where) };
}

function coverage(v: unknown, where: string): Coverage {
  if (!COVERAGE_VALUES.includes(v as Coverage))
    throw new ProfileError(`${where}: coverage must be one of ${COVERAGE_VALUES.join(', ')}, got ${String(v)}`);
  return v as Coverage;
}

const str = (v: unknown, k: string, where: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new ProfileError(`${where}: "${k}" must be a non-empty string`);
  return v;
};
const num = (v: unknown, k: string, where: string): number => {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new ProfileError(`${where}: "${k}" must be a number`);
  return v;
};
