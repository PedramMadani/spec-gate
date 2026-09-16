import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile } from '../src/profile.js';
import { applyVeto, prescore, runChecks } from '../src/checks.js';

const profile = loadProfile('agent-task');
const dim = (id: string) => profile.dimensions.find((d) => d.id === id)!;

test('a dimension with no rule is left to judgement', () => {
  assert.equal(runChecks(dim('must_not_change'), 'anything at all'), null);
  const v = applyVeto(dim('must_not_change'), 1, 'sessions must stay valid', 'anything at all');
  assert.equal(v.coverage, 1);
  assert.equal(v.method, 'model');
  assert.equal(v.vetoed, false);
});

test('claiming test coverage with no test named is capped to zero', () => {
  const v = applyVeto(dim('test_contract'), 1, 'I checked the tests, they are fine', 'Add SSO to the dashboard');
  assert.equal(v.coverage, 0, 'the declaration does not survive the rule');
  assert.equal(v.method, 'deterministic');
  assert.equal(v.vetoed, true);
  assert.match(v.evidence, /declared 1, capped at 0/);
});

test('naming a test path lifts the cap, but does not grant the score', () => {
  const v = applyVeto(dim('test_contract'), 1, 'test/auth.test.ts asserts the session survives', 'Add SSO; see test/auth.test.ts');
  assert.equal(v.coverage, 1);
  assert.equal(v.vetoed, false);
  assert.equal(v.method, 'model', 'a matched rule hands judgement back, it does not settle the score');
});

test('the target path counts as evidence about scope', () => {
  const without = applyVeto(dim('blast_radius'), 1, 'just the login bits', 'tidy up login');
  assert.equal(without.vetoed, true, 'no path anywhere means no scope claim');
  const withTarget = applyVeto(dim('blast_radius'), 1, 'auth only', 'tidy up login', 'src/auth/session.ts');
  assert.equal(withTarget.vetoed, false);
});

test('a declaration at or below the cap is untouched', () => {
  const v = applyVeto(dim('test_contract'), 0, 'no tests named', 'Add SSO');
  assert.equal(v.coverage, 0);
  assert.equal(v.vetoed, false);
});

test('prescore settles what rules can settle and leaves the rest open', () => {
  const pre = prescore(profile, 'Add SSO to the admin dashboard');
  const byId = new Map(pre.map((p) => [p.id, p]));
  assert.equal(byId.get('test_contract')!.method, 'deterministic');
  assert.equal(byId.get('test_contract')!.ceiling, 0, 'settled downward before anyone declares anything');
  assert.equal(byId.get('must_not_change')!.method, 'unscored');
  assert.equal(byId.get('must_not_change')!.ceiling, 1);
});
