import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/hook.js';
import { writeRecord, type RecordInput } from '../src/record.js';
import { loadConfig } from '../src/config.js';
import { loadProfile } from '../src/profile.js';

const profile = loadProfile('agent-task');
const gatedRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-hook-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\n');
  return dir;
};

const authorise = (dir: string, session: string, over: Partial<RecordInput> = {}) =>
  writeRecord(loadConfig(dir), {
    request: 'Add SSO', profile, threshold: 0.8, sufficiency: 0.9,
    dimensions: profile.dimensions.map((d) => ({ id: d.id, coverage: 1 as const, method: 'model' as const, evidence: 'stated' })),
    scorer: { type: 'deterministic+declared', independent: false },
    decision: { verdict: 'proceed' }, caller: { session }, ...over,
  });

test('blocks an edit with no record, and says what to do', () => {
  const dir = gatedRepo();
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'src/app.ts') } });
  assert.equal(d.allow, false);
  assert.match(d.reason!, /no decision record authorises this work/);
  assert.match(d.reason!, /score_request/);
});

test('allows the edit once a record authorises the session', () => {
  const dir = gatedRepo();
  authorise(dir, 's1');
  assert.equal(decide({ session_id: 's1', cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/app.ts') } }).allow, true);
});

test('another session is not covered by this session record', () => {
  const dir = gatedRepo();
  authorise(dir, 's1');
  assert.equal(decide({ session_id: 's2', cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/app.ts') } }).allow, false);
});

test('a blocked record does not authorise anything', () => {
  const dir = gatedRepo();
  authorise(dir, 's1', { decision: { verdict: 'block' }, sufficiency: 0.2 });
  assert.equal(decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'src/app.ts') } }).allow, false);
});

test('an override authorises, because the reason is on the record', () => {
  const dir = gatedRepo();
  authorise(dir, 's1', {
    sufficiency: 0.4,
    decision: { verdict: 'override', override: { reason: 'hotfix', by: 'pedram', at: new Date().toISOString() } },
  });
  assert.equal(decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'src/app.ts') } }).allow, true);
});

test('authorisation goes stale after twelve hours', () => {
  const dir = gatedRepo();
  authorise(dir, 's1');
  const later = new Date(Date.now() + 13 * 3_600_000);
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/app.ts') } }, later);
  assert.equal(d.allow, false);
  assert.match(d.reason!, /hours old/);
});

test('a repo with no config is not gated at all', () => {
  const bare = mkdtempSync(join(tmpdir(), 'spec-gate-bare-'));
  assert.equal(decide({ session_id: 's1', cwd: bare, tool_name: 'Write', tool_input: { file_path: join(bare, 'x.ts') } }).allow, true);
});

test('the gate never blocks its own records or config', () => {
  const dir = gatedRepo();
  for (const f of ['.spec-gate.yml', '.spec-gate/2026-01-01-x.json']) {
    assert.equal(decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, f) } }).allow, true, f);
  }
});

test('shadow mode allows the edit and writes what it would have done', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-shadow-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\nenforce: shadow\n');
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'src/a.ts') } });
  assert.equal(d.allow, true, 'shadow never blocks');
  assert.equal(d.wouldBlock, true, 'but it is honest that it would have');
  assert.equal(d.mode, 'shadow');

  const log = readFileSync(join(dir, '.spec-gate', 'shadow.jsonl'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  const entry = JSON.parse(log[0]!);
  assert.equal(entry.would_block, true);
  assert.equal(entry.file, join(dir, 'src/a.ts'));
  assert.match(entry.reason, /no decision record/);
  assert.ok(entry.at, 'every entry is timestamped, or the log proves nothing about when');
});

test('shadow mode appends, so a week of runs accumulates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-shadow2-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\nenforce: shadow\n');
  for (const f of ['a.ts', 'b.ts', 'c.ts'])
    decide({ session_id: 's1', cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, f) } });
  const log = readFileSync(join(dir, '.spec-gate', 'shadow.jsonl'), 'utf8').trim().split('\n');
  assert.equal(log.length, 3);
});

test('shadow mode stays quiet when the work is authorised', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-shadow3-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\nenforce: shadow\n');
  authorise(dir, 's1');
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/a.ts') } });
  assert.equal(d.allow, true);
  assert.equal(d.wouldBlock, undefined, 'an authorised edit is not a near miss');
  assert.equal(existsSync(join(dir, '.spec-gate', 'shadow.jsonl')), false, 'nothing to log');
});

test('off means off: no block, no log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-off-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\nenforce: off\n');
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'src/a.ts') } });
  assert.equal(d.allow, true);
  assert.equal(d.mode, 'off');
  assert.equal(existsSync(join(dir, '.spec-gate', 'shadow.jsonl')), false);
});

test('a broken config blocks rather than silently disabling the gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-bad-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nenforce: sometimes\n');
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'a.ts') } });
  assert.equal(d.allow, false, 'a typo must not become an open gate');
  assert.match(d.reason!, /misconfigured/);
  assert.match(d.reason!, /enforce must be one of/);
});

test('the config itself stays editable while it is broken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-bad2-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nenforce: sometimes\n');
  const d = decide({ session_id: 's1', cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, '.spec-gate.yml') } });
  assert.equal(d.allow, true, 'or a typo would lock the repo with no way to repair it');
});
