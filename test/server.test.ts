import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

let client: Client;
let repo: string;

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'spec-gate-e2e-'));
  mkdirSync(join(repo, 'src', 'auth'), { recursive: true });
  writeFileSync(join(repo, '.spec-gate.yml'), 'profile: agent-task\nrecords: .spec-gate\n');

  client = new Client({ name: 'spec-gate-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('node_modules/.bin/tsx'), resolve('src/index.ts')],
      cwd: repo,
    }),
  );
});

after(async () => { await client.close(); });

test('exposes exactly the two tools, with schemas', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['score_request', 'write_record']);
  const score = tools.find((t) => t.name === 'score_request')!;
  assert.ok(score.inputSchema, 'input schema reaches the client');
  assert.ok(score.outputSchema, 'output schema reaches the client');
});

test('an unscored request blocks, and says how to score it', async () => {
  const res = await client.callTool({ name: 'score_request', arguments: { request: 'Add SSO to the admin dashboard' } });
  const out = res.structuredContent as Record<string, any>;
  assert.equal(out.verdict, 'block', 'unscored is not passing');
  assert.equal(out.sufficiency, 0);
  assert.equal(out.threshold, 0.8);
  assert.equal(out.profile.id, 'agent-task');
  assert.equal(out.dimensions.length, 4);
  assert.deepEqual(out.blocking.sort(), ['blast_radius', 'done_condition', 'must_not_change', 'test_contract']);
  assert.equal(out.scorer.independent, false, 'a self-declared score is never independent');
  assert.match(out.instructions, /cannot be revised/);
});

test('every dimension carries the question that closes it', async () => {
  const res = await client.callTool({ name: 'score_request', arguments: { request: 'tidy up the login page' } });
  const out = res.structuredContent as Record<string, any>;
  for (const d of out.dimensions) {
    assert.equal(typeof d.ask, 'string');
    assert.ok(d.ask.length > 10, `${d.id} has a real question`);
    assert.equal(d.method, 'unscored');
  }
});

test('write_record writes a record when coverage clears the threshold', async () => {
  const res = await client.callTool({
    name: 'write_record',
    arguments: {
      request: 'Add SSO to the admin dashboard',
      dimensions: [
        { id: 'must_not_change', coverage: 1, evidence: 'existing sessions must stay valid' },
        { id: 'test_contract', coverage: 1, evidence: 'test/auth.test.ts asserts session persistence' },
        { id: 'blast_radius', coverage: 1, evidence: 'src/auth only' },
        { id: 'done_condition', coverage: 1, evidence: 'login through the IdP succeeds' },
      ],
      constraints: ['tokens never written to logs'],
      session: 'sess-1',
    },
  });
  const out = res.structuredContent as Record<string, any>;
  assert.equal(out.decision, 'proceed');
  assert.equal(out.sufficiency, 1);
  assert.match(out.hash, /^sha256:[0-9a-f]{64}$/);
  const stored = JSON.parse(readFileSync(out.path, 'utf8'));
  assert.equal(stored.decision.verdict, 'proceed');
  assert.equal(stored.caller.session, 'sess-1');
  assert.ok(existsSync(out.markdown_path), 'the readable sibling exists');
});

test('a thin request is blocked, and the block is recorded', async () => {
  const res = await client.callTool({
    name: 'write_record',
    arguments: {
      request: 'clean up the login page',
      dimensions: [
        { id: 'must_not_change', coverage: 0, evidence: 'nothing stated' },
        { id: 'test_contract', coverage: 0, evidence: 'no tests named' },
        { id: 'blast_radius', coverage: 0.4, evidence: 'mentions the login page only' },
        { id: 'done_condition', coverage: 0, evidence: '"clean up" is not observable' },
      ],
      session: 'sess-1',
    },
  });
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /blocked at 0\.08/);
  assert.match(JSON.stringify(res.content), /override/);
});

test('the verdict is computed, not accepted from the caller', async () => {
  const res = await client.callTool({
    name: 'write_record',
    arguments: {
      request: 'ship it',
      dimensions: [{ id: 'must_not_change', coverage: 1, evidence: 'x' }],
      session: 'sess-1',
    },
  });
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /every dimension must be scored/);
});

test('an override below the threshold writes, and carries the reason', async () => {
  const res = await client.callTool({
    name: 'write_record',
    arguments: {
      request: 'hotfix the login redirect',
      dimensions: [
        { id: 'must_not_change', coverage: 0.4, evidence: 'partial' },
        { id: 'test_contract', coverage: 0, evidence: 'none named' },
        { id: 'blast_radius', coverage: 0.7, evidence: 'auth redirect only' },
        { id: 'done_condition', coverage: 0.4, evidence: 'redirect works' },
      ],
      override: { reason: 'production outage, gap accepted', by: 'pedram' },
      session: 'sess-1',
    },
  });
  const out = res.structuredContent as Record<string, any>;
  assert.equal(out.decision, 'override');
  const stored = JSON.parse(readFileSync(out.path, 'utf8'));
  assert.equal(stored.decision.override.reason, 'production outage, gap accepted');
  assert.equal(stored.decision.override.by, 'pedram');
});
