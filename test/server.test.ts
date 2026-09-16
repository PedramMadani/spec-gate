import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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

test('write_record refuses rather than pretending to authorise', async () => {
  const res = await client.callTool({
    name: 'write_record',
    arguments: { request: 'Add SSO', decision: 'proceed' },
  });
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /not implemented/);
});
