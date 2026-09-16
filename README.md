<h1 align="center">spec-gate</h1>

<p align="center">
  <strong>A gate that refuses to let an AI agent start on an underspecified request,<br>and a committed record of what was missing.</strong>
</p>

<p align="center">
  <a href="https://doi.org/10.1109/RE68928.2026.00028"><img alt="Paper" src="https://img.shields.io/badge/IEEE%20RE%202026-10.1109%2FRE68928.2026.00028-00629B"></a>
  <a href="https://doi.org/10.5281/zenodo.20187897"><img alt="Replication package" src="https://img.shields.io/badge/replication-Zenodo-1682D4"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-skeleton%20v0.0.1-orange">
  <a href="LICENSE"><img alt="Code licence" src="https://img.shields.io/badge/code-Apache--2.0-blue"></a>
  <a href="LICENSE-spec"><img alt="Spec licence" src="https://img.shields.io/badge/spec-CC--BY--4.0-blue"></a>
</p>

---

Coding agents start as soon as they are asked, whatever the request leaves out. The omissions are not random. Security posture, compliance constraints and operational requirements are the least covered dimensions in real requests, and the code that comes back looks finished either way.

Most tooling helps you write a specification. **spec-gate decides whether the specification is sufficient to start, and writes down the decision.**

```
request ──▶ score against profile ──▶ below threshold?  ──▶ BLOCK + the questions that close the gap
                                          │
                                          └─ at or above ──▶ PROCEED + a committed record of why
```

It refuses. Below the threshold it returns a block, not a warning. An override is allowed and must carry a written reason, which lands in the record.

## Why a threshold, and not just more questions

Asking the model to clarify sounds like the safe option. Measured across five models on 100 deliberately underspecified requests, clarification **without** a stopping rule made critical omissions **worse** on four of them. Gating on a sufficiency threshold reduced them on all five.

| Model | Direct generation | Clarification, no gate | Gated | Reduction |
|---|---:|---:|---:|---:|
| GPT-OSS 20B | 10.9% | 11.7% | **5.4%** | −50% |
| Qwen 2.5 7B | 28.2% | 36.0% | **14.6%** | −48% |
| Mistral 7B | 31.4% | 45.3% | **17.3%** | −45% |
| GPT-4o-mini | 18.5% | 36.0% | **11.7%** | −37% |
| Llama 3.2 3B | 34.8% | 38.2% | **24.8%** | −29% |

Critical omission rate: the share of safety, compliance and operational requirements the output left out. Lower is better. Method, baselines and full results: [IEEE RE 2026](https://doi.org/10.1109/RE68928.2026.00028).

Two caveats the paper states and this README will not bury. Answers came from a simulated user who always knew the right answer, so those reductions are an upper bound. Scorer agreement with human annotation was 0.71 (Cohen's kappa): good enough to gate on, not good enough to trust silently, which is why every score carries its evidence.

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
  "scorer": {"type": "deterministic+declared", "independent": false},
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

**The profile is not a parameter.** It comes from `.spec-gate.yml` in the repo, so a caller cannot quietly choose a softer one.

### `write_record`

Stores the decision. This is the artifact, and the reason the tool exists.

```jsonc
// in
{"request": "...", "answers": [...], "decision": "proceed"}
// or
{"request": "...", "decision": "override", "override": {"reason": "hotfix, gap accepted", "by": "pedram"}}

// out
{"path": ".spec-gate/2026-09-16-add-sso.json", "hash": "sha256:9f2c...", "decision": "proceed"}
```

## The record

A decision record answers one question: **why was this allowed to proceed?** It holds the request, the profile and its version, per-dimension coverage with the evidence behind each score and whether a rule or a model produced it, every question asked and the answer given, the constraints and assumptions that resulted, any override with its reason and author, which scorer ran, and a timestamp. Full contract: [`schema/record.schema.json`](schema/record.schema.json).

Every record gets a Markdown sibling, so a reviewer who does not read JSON can still read the decision in a pull request:

```markdown
### Add SSO to the admin dashboard
**Proceeded** at 0.86 against a threshold of 0.80 · profile `agent-task@0.1.0` · scorer: rules + declared (not independent)

**Constraints**  existing sessions stay valid through rollout · tokens never written to logs
**Assumptions**  IdP is the existing Entra tenant (unconfirmed)
**Asked**        Which current behaviour must keep working? → "existing sessions must not drop"
```

Records are committed to the repository they belong to. Uncommitted evidence is not evidence, and a record next to the change it authorised is reviewable where the change is reviewed.

> **Assert on the stored record, never on console output.** Tests read the JSON fields.

## Profiles

Dimensions are data, so a team can fit them to its own failures. A profile sets the dimensions, their weights, the coverage rubric and the threshold.

| Profile | For | Dimensions | Status |
|---|---|---|---|
| [`agent-task`](profiles/agent-task.yaml) | Autonomous queues, where an item runs with no human in the loop | What must not change · what the tests assert · blast radius · definition of done | v0.1 |
| `sdlc-critical` | Security, compliance and operations-critical work | The paper's ten, grounded in ISO/IEC/IEEE 29148 and Volere | v0.2 |

Where a dimension can be checked without a model, it is. A rule cannot be talked out of its answer.

## Scoring

Rules first, declaration second, and a rule always wins.

Where a dimension can be settled mechanically it is, and that score cannot be revised. Whatever the rules cannot answer, the calling agent declares against the rubric, quoting evidence from the request itself. A declared score is marked as declared in the record, so a reader can see exactly which judgements were self-reported and which were not. An independent scorer is configurable for anyone who wants the judge separated from the judged.

This is deliberately not MCP sampling. Sampling was deprecated in the 2026-07-28 spec revision, and of the clients people actually use only VS Code implements it, so a design resting on it would not run where it is needed. Blocking questions are put to the user through elicitation instead, which is supported in Claude Code, Cursor, VS Code and Codex.

Scorer agreement with human annotation was 0.71 (Cohen's kappa) in the paper. Good enough to gate on, not good enough to trust silently, which is why every score carries its evidence.

## Design decisions

The reasoning, and what was deliberately excluded, is in [`DECISIONS.md`](DECISIONS.md). In short:

- **It refuses rather than warns.** A gate with an escape hatch is a warning.
- **Overrides are never silent.** A reason, an author and a timestamp, in the record.
- **The repo picks the profile, not the caller.**
- **Records are committed**, JSON as the source of truth, Markdown for humans.
- **No signing or hash chaining.** Git history already gives tamper evidence here.
- **Not a spec generator, not a plan mode, not a linter.** It runs once, before the work starts, and anything outside the profile passes untouched.

## Enforcement

Calling the gate is voluntary until a hook makes it not. `.claude/settings.json` registers a `PreToolUse` hook that **denies file edits in a gated repository until a record authorises the work**:

```
Write src/auth/session.ts
  └─ hook: no decision record authorises this work → denied, with instructions
```

An authorisation is for a piece of work, not a standing permission: it is scoped to the session that earned it and goes stale after twelve hours. A blocked record authorises nothing. A record whose hash no longer matches its content authorises nothing either. A repository with no `.spec-gate.yml` is not gated at all, so the hook is silent everywhere else.

An override still works, and still costs a written reason on the record.

## Run it

```bash
git clone https://github.com/PedramMadani/spec-gate && cd spec-gate && npm install
claude mcp add spec-gate -- npx tsx /absolute/path/to/spec-gate/src/index.ts
```

Or in `.mcp.json` (Claude Code) or `.cursor/mcp.json` (Cursor):

```json
{ "mcpServers": { "spec-gate": { "command": "npx", "args": ["tsx", "/absolute/path/to/spec-gate/src/index.ts"] } } }
```

Then put a [`.spec-gate.yml`](examples/.spec-gate.yml) in the repo you want gated.

Not on npm yet. Scores are currently all caller-declared, since the deterministic rule veto lands in v0.1.

## Status

**Working, and unfinished.** The gate refuses, records are written and enforced by a hook. The deterministic checks that veto a declared score are not built yet, which means a caller could currently declare its way through.

| | Scope | |
|---|---|---|
| **v0.0.1** | Server over stdio, config and profile resolution, both tools working, records written and hashed, PreToolUse enforcement hook, 34 tests | ✅ |
| **v0.1** | Deterministic checks, rule veto on declared scores, elicitation for blocking questions, running against one real autonomous queue | |
| **v0.2** | `sdlc-critical` profile | |

Open tasks: [`TASKS.md`](TASKS.md). Omissions it has caught in real use: [`CATCHES.md`](CATCHES.md).

This is a reference implementation of a published method, maintained as time allows. **No support commitment and no roadmap.** Issues are welcome, answers are not guaranteed.

## Citation

```bibtex
@inproceedings{madani2026rsga,
  author    = {Madani, Mohammadamin and Nahhas, Abdulrahman and Chernigovskaya, Maria and Turowski, Klaus},
  title     = {Requirements Sufficiency Gating for {LLM}-Assisted Automation: When Should Generation Proceed?},
  booktitle = {2026 IEEE 34th International Requirements Engineering Conference (RE)},
  year      = {2026},
  pages     = {262--272},
  address   = {Montreal, QC, Canada},
  publisher = {IEEE},
  doi       = {10.1109/RE68928.2026.00028}
}
```

## Licence

Code [Apache-2.0](LICENSE). Dimension spec, profiles and schema [CC-BY-4.0](LICENSE-spec).
