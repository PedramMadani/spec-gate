#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { loadConfig, profileFor, ConfigError } from './config.js';
import { loadProfile, ProfileError } from './profile.js';
import { COVERAGE_VALUES } from './types.js';

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
        'Stores the decision as a committed record: what was missing, what was assumed, who authorised proceeding.',
      inputSchema: z.object({
        request: z.string().min(1),
        decision: z.enum(['proceed', 'block', 'override']),
        override: z
          .object({ reason: z.string().min(1), by: z.string().min(1) })
          .optional()
          .describe('Required when decision is "override". A reason is mandatory and is stored verbatim.'),
      }),
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: 'write_record is not implemented in 0.0.1. No record was written, so nothing here should be treated as authorised.',
        },
      ],
      isError: true,
    }),
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
