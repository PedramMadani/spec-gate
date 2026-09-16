#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { loadConfig, profileFor, ConfigError } from './config.js';
import { loadProfile, ProfileError } from './profile.js';
import { COVERAGE_VALUES } from './types.js';
import { writeRecord, RecordError, type ScoredDimension } from './record.js';

const VERSION = '0.0.1';

const scoreInput = z.object({
  request: z.string().min(1).describe('The request as received, verbatim.'),
  target: z
    .string()
    .optional()
    .describe('Path the work will touch, used to select the profile. Does not choose the profile directly.'),
  cwd: z.string().optional().describe('Directory to resolve .spec-gate.yml from. Defaults to the process cwd.'),
});

const dimensionOut = z.object({
  id: z.string(),
  question: z.string(),
  weight: z.number(),
  coverage: z.number(),
  method: z.enum(['deterministic', 'model', 'unscored']),
  evidence: z.string().nullable(),
  ask: z.string().nullable(),
});

const scoreOutput = z.object({
  verdict: z.enum(['proceed', 'block']),
  sufficiency: z.number(),
  threshold: z.number(),
  profile: z.object({ id: z.string(), version: z.string(), source: z.string() }),
  scorer: z.object({
    type: z.enum(['deterministic+declared', 'external', 'deterministic-only']),
    independent: z.boolean(),
  }),
  rubric: z.record(z.string(), z.string()),
  dimensions: z.array(dimensionOut),
  blocking: z.array(z.string()),
  instructions: z.string(),
});

/** Scoring, without sampling: the rules answer what they can, the caller declares the
 *  rest against the rubric, and a rule always wins over a declaration. Every dimension
 *  carries how it was scored, so a self-reported score is visible as one. */
const DECLARE = [
  'This request has not been scored yet. For each dimension below with method "unscored", judge',
  `coverage against the rubric (${COVERAGE_VALUES.join(', ')}) and quote the evidence from the request itself.`,
  'Do not infer from what you intend to do; score only what the request states. Dimensions already',
  'marked "deterministic" are settled by rule and cannot be revised. Then call write_record with your',
  'declared scores. Below the threshold the gate blocks, and proceeding requires an override with a',
  'written reason.',
].join(' ');

// `spec-gate hook` is the PreToolUse enforcement path; with no argument the binary
// is the MCP server. One binary, so a repo installs one thing.
if (process.argv[2] === 'hook') {
  const { runHook } = await import('./hook.js');
  process.exit(await runHook());
}

const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

serveStdio(() => {
  const server = new McpServer({ name: 'spec-gate', version: VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    'score_request',
    {
      title: 'Score a request before starting work',
      description:
        'Scores a request against the repository profile and returns a proceed or block verdict with the questions that close the gap. Writes nothing.',
      inputSchema: scoreInput,
      outputSchema: scoreOutput,
    },
    async ({ request, target, cwd }) => {
      const config = loadConfig(cwd ?? process.cwd());
      const profile = loadProfile(profileFor(config, target), config.root);
      const threshold = config.thresholdOverride ?? profile.threshold;

      // v0.0.1: nothing is scored yet, so everything is unscored and the verdict is
      // block. That is the right default: an unscored request is not a passing one.
      const dimensions = profile.dimensions.map((d) => ({
        id: d.id,
        question: d.question,
        weight: d.weight,
        coverage: 0,
        method: 'unscored' as const,
        evidence: null,
        ask: d.question,
      }));

      const data = {
        verdict: 'block' as const,
        sufficiency: 0,
        threshold,
        profile: { id: profile.id, version: profile.version, source: profile.source },
        scorer: { type: 'deterministic+declared' as const, independent: false },
        rubric: profile.rubric,
        dimensions,
        blocking: dimensions.map((d) => d.id),
        instructions: DECLARE,
      };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );

  server.registerTool(
    'write_record',
    {
      title: 'Write the decision record',
      description:
        'Stores the decision as a committed record: what was missing, what was assumed, who authorised proceeding. The verdict is computed from the declared coverage, not accepted from the caller.',
      inputSchema: z.object({
        request: z.string().min(1).describe('The request as received, verbatim.'),
        target: z.string().optional(),
        cwd: z.string().optional(),
        dimensions: z
          .array(
            z.object({
              id: z.string(),
              coverage: z.union([z.literal(0), z.literal(0.4), z.literal(0.7), z.literal(1)]),
              evidence: z.string().min(1).describe('Quote from the request that justifies this score.'),
            }),
          )
          .describe('One entry per profile dimension, scored against the rubric.'),
        constraints: z.array(z.string()).optional(),
        assumptions: z.array(z.string()).optional().describe('Carried but not established. Listing them is what makes them visible.'),
        override: z
          .object({ reason: z.string().min(1), by: z.string().min(1) })
          .optional()
          .describe('Only to proceed below the threshold. The reason is stored verbatim and is not optional.'),
        session: z.string().optional().describe('Session id, so the pre-work hook can scope authorisation to this run.'),
      }),
      outputSchema: z.object({
        decision: z.enum(['proceed', 'block', 'override']),
        sufficiency: z.number(),
        threshold: z.number(),
        path: z.string(),
        markdown_path: z.string(),
        hash: z.string(),
        missing: z.array(z.string()),
      }),
    },
    async ({ request, target, cwd, dimensions, constraints, assumptions, override, session }) => {
      const config = loadConfig(cwd ?? process.cwd());
      const profile = loadProfile(profileFor(config, target), config.root);
      const threshold = config.thresholdOverride ?? profile.threshold;

      const declared = new Map(dimensions.map((d) => [d.id, d]));
      const unknown = dimensions.filter((d) => !profile.dimensions.some((p) => p.id === d.id)).map((d) => d.id);
      if (unknown.length)
        return fail(`unknown dimension(s) for profile ${profile.id}: ${unknown.join(', ')}`);
      const missingScores = profile.dimensions.filter((d) => !declared.has(d.id)).map((d) => d.id);
      if (missingScores.length)
        return fail(`every dimension must be scored before a record can be written; missing: ${missingScores.join(', ')}`);

      // Weighted coverage, computed here rather than taken from the caller: a verdict
      // the caller could assert is not a gate.
      const scored: ScoredDimension[] = profile.dimensions.map((d) => {
        const got = declared.get(d.id)!;
        return { id: d.id, coverage: got.coverage, method: 'model' as const, evidence: got.evidence };
      });
      const sufficiency = profile.dimensions.reduce((a, d) => a + d.weight * declared.get(d.id)!.coverage, 0);
      const passes = sufficiency >= threshold;
      const verdict = passes ? ('proceed' as const) : override ? ('override' as const) : ('block' as const);

      if (!passes && !override) {
        const missing = profile.dimensions.filter((d) => declared.get(d.id)!.coverage < 1).map((d) => d.id);
        try {
          writeRecord(config, {
            request, profile, threshold, sufficiency, dimensions: scored, constraints, assumptions,
            scorer: { type: 'deterministic+declared', independent: false },
            decision: { verdict: 'block' },
            caller: session ? { session } : undefined,
          });
        } catch { /* a blocked record failing to write must not look like authorisation */ }
        return fail(
          `blocked at ${sufficiency.toFixed(2)} against a threshold of ${threshold}. Under-covered: ${missing.join(', ')}. ` +
            'Put the open questions to the user, then score again. To proceed anyway, call write_record with an override and a written reason.',
        );
      }

      try {
        const out = writeRecord(config, {
          request, profile, threshold, sufficiency, dimensions: scored, constraints, assumptions,
          scorer: { type: 'deterministic+declared', independent: false },
          decision:
            verdict === 'override'
              ? { verdict, override: { reason: override!.reason, by: override!.by, at: new Date().toISOString() } }
              : { verdict },
          caller: session ? { session } : undefined,
        });
        const data = {
          decision: verdict,
          sufficiency: Math.round(sufficiency * 1000) / 1000,
          threshold,
          path: out.path,
          markdown_path: out.markdownPath,
          hash: out.hash,
          missing: profile.dimensions.filter((d) => declared.get(d.id)!.coverage < 1).map((d) => d.id),
        };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
      } catch (e) {
        return fail(e instanceof RecordError ? e.message : `could not write the record: ${(e as Error).message}`);
      }
    },
  );

  return server;
});

// A misconfigured repo must fail loudly at the call site, not silently pass.
process.on('uncaughtException', (e) => {
  if (e instanceof ConfigError || e instanceof ProfileError) {
    process.stderr.write(`spec-gate: ${e.message}\n`);
    process.exit(1);
  }
  throw e;
});
