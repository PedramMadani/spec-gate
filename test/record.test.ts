import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRecord, writeRecord, verifyRecord, hashOf, renderMarkdown, latestAuthorisation, RecordError, type RecordInput } from '../src/record.js';
import { loadProfile } from '../src/profile.js';
import { loadConfig } from '../src/config.js';

const profile = loadProfile('agent-task');

const base = (over: Partial<RecordInput> = {}): RecordInput => ({
  request: 'Add SSO to the admin dashboard',
  profile,
  threshold: 0.8,
  sufficiency: 0.86,
  dimensions: [
    { id: 'must_not_change', coverage: 1, method: 'model', evidence: 'existing sessions must stay valid' },
    { id: 'test_contract', coverage: 0.7, method: 'deterministic', evidence: 'names test/auth.test.ts' },
    { id: 'blast_radius', coverage: 1, method: 'deterministic', evidence: 'src/auth only' },
    { id: 'done_condition', coverage: 0.7, method: 'model', evidence: 'login via IdP succeeds' },
  ],
  constraints: ['tokens never written to logs'],
  assumptions: ['IdP is the existing tenant (unconfirmed)'],
  scorer: { type: 'deterministic+declared', independent: false },
  decision: { verdict: 'proceed' },
  ...over,
});

const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-rec-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\n');
  return dir;
};

test('a record validates against its own published schema', () => {
  const r = buildRecord(base());
  assert.equal(r.schema_version, '0.1.0');
  assert.ok(verifyRecord(r));
});

test('the hash covers content, so any edit breaks it', () => {
  const r = buildRecord(base());
  assert.ok(verifyRecord(r));
  const tampered = { ...r, sufficiency: 0.99 };
  assert.equal(verifyRecord(tampered), false, 'raising the score must break the hash');
  const reordered = Object.fromEntries(Object.entries(r).reverse());
  assert.equal(hashOf(reordered), r.hash, 'key order must not change the hash');
});

test('an override without a reason is refused, not written', () => {
  assert.throws(
    () => buildRecord(base({ decision: { verdict: 'override', override: { reason: '   ', by: 'p', at: new Date().toISOString() } } })),
    (e: Error) => e instanceof RecordError && /requires a written reason/.test(e.message),
  );
});

test('an off-rubric coverage value is refused by the schema', () => {
  const input = base();
  input.dimensions[0]!.coverage = 0.63;
  assert.throws(() => buildRecord(input), /does not satisfy the schema/);
});

test('writes the JSON and a readable sibling, and the JSON round-trips', () => {
  const dir = repo();
  const out = writeRecord(loadConfig(dir), base());
  const onDisk = JSON.parse(readFileSync(out.path, 'utf8'));
  assert.ok(verifyRecord(onDisk), 'the stored record verifies, not just the in-memory one');
  assert.equal(onDisk.hash, out.hash);
  const md = readFileSync(out.markdownPath, 'utf8');
  assert.match(md, /\*\*Proceeded\*\* at 0\.86 against a threshold of 0\.8/);
  assert.match(md, /tokens never written to logs/);
  assert.match(md, /not established, carried anyway/);
  assert.match(md, /deterministic/);
});

test('the override reason reaches the readable sibling', () => {
  const md = renderMarkdown(buildRecord(base({
    decision: { verdict: 'override', override: { reason: 'hotfix, gap accepted', by: 'pedram', at: new Date().toISOString() } },
  })));
  assert.match(md, /\*\*Override\*\* by pedram/);
  assert.match(md, /> hotfix, gap accepted/);
});

test('a blocked record authorises nothing', () => {
  const dir = repo();
  const config = loadConfig(dir);
  writeRecord(config, base({ decision: { verdict: 'block' }, sufficiency: 0.2 }));
  assert.equal(latestAuthorisation(config), null);
});

test('a tampered record authorises nothing', () => {
  const dir = repo();
  const config = loadConfig(dir);
  const out = writeRecord(config, base());
  const r = JSON.parse(readFileSync(out.path, 'utf8'));
  r.decision.verdict = 'proceed';
  r.sufficiency = 0.99; // hash now stale
  writeFileSync(out.path, JSON.stringify(r));
  assert.equal(latestAuthorisation(config), null, 'an edited record must not authorise work');
});

test('a proceed record authorises, and can be scoped to a session', () => {
  const dir = repo();
  const config = loadConfig(dir);
  writeRecord(config, base({ caller: { session: 'abc' } }));
  assert.ok(latestAuthorisation(config));
  assert.ok(latestAuthorisation(config, 'abc'));
  assert.equal(latestAuthorisation(config, 'other'), null, 'another session is not authorised by this record');
});
