import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfile, ProfileError } from '../src/profile.js';

const tmp = (name: string, body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-'));
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};

test('loads the shipped agent-task profile', () => {
  const p = loadProfile('agent-task');
  assert.equal(p.id, 'agent-task');
  assert.equal(p.threshold, 0.8);
  assert.equal(p.dimensions.length, 4);
  assert.ok(p.dimensions.some((d) => d.id === 'must_not_change'));
  assert.ok(p.source.endsWith('profiles/agent-task.yaml'));
});

test('rejects weights that do not sum to one', () => {
  const path = tmp('bad.yaml', `id: bad\nversion: 0.1.0\nthreshold: 0.8\ndimensions:\n  - {id: a, weight: 0.5, question: q}\n  - {id: b, weight: 0.2, question: q}\n`);
  assert.throws(() => loadProfile(path), (e: Error) => e instanceof ProfileError && /sum to 0.700/.test(e.message));
});

test('rejects a duplicate dimension id', () => {
  const path = tmp('dupe.yaml', `id: d\nversion: 0.1.0\nthreshold: 0.8\ndimensions:\n  - {id: a, weight: 0.5, question: q}\n  - {id: a, weight: 0.5, question: q}\n`);
  assert.throws(() => loadProfile(path), /duplicate dimension id/);
});

test('rejects an off-rubric coverage value', () => {
  const path = tmp('rubric.yaml', `id: r\nversion: 0.1.0\nthreshold: 0.8\ndimensions:\n  - id: a\n    weight: 1\n    question: q\n    checks: [{id: c, kind: regex, pattern: "x", on_match: 0.63, on_miss: 0}]\n`);
  assert.throws(() => loadProfile(path), /coverage must be one of/);
});

test('rejects an invalid regex rather than scoring it zero', () => {
  const path = tmp('re.yaml', `id: r\nversion: 0.1.0\nthreshold: 0.8\ndimensions:\n  - id: a\n    weight: 1\n    question: q\n    checks: [{id: c, kind: regex, pattern: "([", on_match: 1, on_miss: 0}]\n`);
  assert.throws(() => loadProfile(path), /invalid regex/);
});
