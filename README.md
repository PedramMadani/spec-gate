# spec-gate

*Working name. Reference implementation of Requirements-Sufficiency-Gated Automation (RSGA), IEEE RE 2026, [doi:10.1109/RE68928.2026.00028](https://doi.org/10.1109/RE68928.2026.00028).*

**A check that runs before an AI agent starts work, and a record of what it found.**

Coding agents begin as soon as they are asked, whatever the request leaves out. The omissions are not random: security posture, compliance constraints and operational requirements are the least covered dimensions in real requests, and the resulting code looks finished. Most tooling helps you write a specification. spec-gate decides whether the specification is sufficient to start, and writes down the decision.

Measured on 100 underspecified requests across five models: 29 to 50 percent fewer critical omissions than generating directly. Asking clarifying questions without a stopping rule made omissions worse on four of the five.

**It refuses.** Below the threshold it returns a block, not a warning. An override is allowed and must carry a written reason, which lands in the record.

## Interface

Two tools over MCP. One implementation, usable from any client that speaks the protocol.

### `score_request`

Scores a request, returns a verdict. Writes nothing.

```jsonc
// in
{
  "request": "Add SSO to the admin dashboard",
  "context": ["repo:acme/admin", "file:docs/auth.md"]   // optional
}

// out
{
  "verdict": "block",                 // "proceed" | "block"
  "sufficiency": 0.62,                // weighted coverage, 0 to 1
  "threshold": 0.8,
  "profile": {"id": "agent-task", "version": "0.1.0", "source": ".spec-gate.yml"},
  "scorer": {"type": "sampling", "model": "<as reported by the client>"},
  "dimensions": [
    {"id": "must_not_change", "coverage": 0.4, "method": "model",
     "evidence": "mentions SSO, says nothing about existing sessions",
     "ask": "Which current behaviour must keep working exactly as it does now?"},
    {"id": "test_contract", "coverage": 0.0, "method": "deterministic",
     "evidence": "no test file or assertion named in the request",
     "ask": "Which tests already assert behaviour this change must not break?"}
  ],
  "blocking": ["must_not_change", "test_contract"]
}
```

One question per uncovered dimension, ordered by how much it moves the verdict. The caller decides whether to put them to the user.

The profile is not a parameter. It comes from `.spec-gate.yml` in the repo, so a caller cannot choose a softer one.

### `write_record`

Stores the decision. This is the artifact, and the reason the tool exists.

```jsonc
// in
{ "request": "...", "answers": [...], "decision": "proceed" }
// or
{ "request": "...", "decision": "override", "override": {"reason": "hotfix, gap accepted", "by": "pedram"} }

// out
{ "path": ".spec-gate/2026-09-16-add-sso.json", "hash": "sha256:9f2c...", "decision": "proceed" }
```

The record holds the request, the profile and its version, per-dimension coverage with evidence and how it was scored, every question asked and the answer given, the resulting constraints and assumptions, the verdict, any override with its reason and author, which scorer ran, and a timestamp. Schema: [`schema/record.schema.json`](schema/record.schema.json).

Records are committed to the repo they belong to. Uncommitted evidence is not evidence. Each one gets a Markdown sibling so a reviewer who does not read JSON can still read the decision in a pull request.

**Assert on the stored record, never on console output.** Tests read the JSON fields.

## Profiles

Dimensions are data, so a team can fit them to its own failures. A profile sets the dimensions, their weights, the coverage rubric and the threshold.

- **[`agent-task`](profiles/agent-task.yaml)** ships first: the short profile for autonomous queues, where an underspecified item is executed with no human in the loop.
- **`sdlc-critical`**, the paper's ten dimensions grounded in ISO/IEC/IEEE 29148 and Volere, lands in v0.2.

Where a dimension can be checked without a model, it is. A rule cannot be talked out of its answer.

## Scoring

By default spec-gate asks the calling agent through MCP sampling, so it needs no key and no account. That means the model being gated also scores the request, which is a real weakness: an independent scorer is configurable, and **the record always names which one ran.**

Scorer agreement with human annotation was 0.71 (Cohen's kappa) in the paper. Good enough to gate on, not good enough to trust silently, which is why every score carries its evidence.

## Not in scope

No hosted service. No dashboard. No review of code, and it is not a linter. It runs once, before the work starts. Anything outside the profile passes untouched.

## Status and support

**Interface and schema only. No implementation yet.** v0.1 is the two tools, the `agent-task` profile, records written and committed, running against one real autonomous queue.

This is a reference implementation of a published method, maintained as time allows. **No support commitment and no roadmap.** Issues are welcome, answers are not guaranteed.

The benchmark, baselines and results are in the replication package: [doi:10.5281/zenodo.20187897](https://doi.org/10.5281/zenodo.20187897).

## Licence

Code Apache-2.0 ([LICENSE](LICENSE)). The dimension spec and profiles CC-BY-4.0 ([LICENSE-spec](LICENSE-spec)).
