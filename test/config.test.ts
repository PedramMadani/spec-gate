import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, profileFor, findConfig, ConfigError } from '../src/config.js';

const repo = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-repo-'));
  writeFileSync(join(dir, '.spec-gate.yml'), body);
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  return dir;
};

const CONFIG = `profile: agent-task\nrecords: .spec-gate\nrules:\n  - {paths: [src/auth], profile: strict}\n  - {paths: [src], profile: loose}\n`;

test('finds the config by walking up from a nested directory', () => {
  const dir = repo(CONFIG);
  assert.equal(findConfig(join(dir, 'src', 'auth')), join(dir, '.spec-gate.yml'));
});

test('longest matching path wins, whatever the rule order', () => {
  const c = loadConfig(repo(CONFIG));
  assert.equal(profileFor(c, 'src/auth/session.ts'), 'strict');
  assert.equal(profileFor(c, 'src/ui/button.ts'), 'loose');
  assert.equal(profileFor(c, 'README.md'), 'agent-task');
  assert.equal(profileFor(c, undefined), 'agent-task');
});

test('a path outside the repo falls back to the default, never to ungated', () => {
  const c = loadConfig(repo(CONFIG));
  assert.equal(profileFor(c, '../elsewhere/secret.ts'), 'agent-task');
});

test('missing config is an error, not a silent pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-bare-'));
  assert.throws(() => loadConfig(dir), (e: Error) => e instanceof ConfigError && /no \.spec-gate\.yml/.test(e.message));
});

test('rejects a threshold outside (0, 1]', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-thr-'));
  writeFileSync(join(dir, '.spec-gate.yml'), 'profile: agent-task\nthreshold: 1.4\n');
  assert.throws(() => loadConfig(dir), /threshold must be a number/);
});
