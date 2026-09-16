# Decisions

Settled in a grilling session on 2026-09-16, before any code. Each line is a decision,
not a preference. Change one deliberately, or not at all.

## What this is
- A **credibility asset** with a research instrument as a side effect. Not a supported
  product, not a business. Success is citations, essays and advisory conversations.
- Reference implementation of RSGA (IEEE RE 2026, doi:10.1109/RE68928.2026.00028).

## Shape
- Public repo on a personal account, **not** under a venture org. Code Apache-2.0
  (patent grant matters if a vendor adopts the method), spec CC-BY-4.0.
- Two MCP tools, `score_request` and `write_record`. TypeScript server so it installs
  in one command; the benchmark and scoring experiments stay Python, where they live.
- No hosted service, no dashboard, no code review, no linting.
- Working name. The paper is credited in the first line of the README; RSGA is the
  method's name and reads as jargon on a repo page.

## Behaviour
- **It refuses.** Below threshold it blocks. Everything else in this field warns.
- **Overrides are allowed and never silent.** A written reason, an author and a
  timestamp land in the record. A record full of overrides is itself the finding.
- **The profile comes from repo config, not from the caller.** A caller that can pick
  its profile picks the lenient one, which defeats the gate.
- **Records are committed** next to the change they authorised, JSON plus a Markdown
  sibling for a reviewer who does not read JSON.
- **The scorer is named in every record.** ~~Sampling by default~~ **CHANGED 2026-09-16
  on verified facts:** MCP sampling was deprecated in the 2026-07-28 spec revision and only
  VS Code implements it, so the no-key default could not exist. Scoring is now rules first,
  then agent-declared against the rubric with a rule veto, and an optional configured
  external scorer. A declared score is labelled as declared in the record, which is more
  honest than sampling would have been. Blocking questions go to the user through
  elicitation (supported in Claude Code, Cursor, VS Code, Codex).
- Deterministic checks wherever a dimension allows one. A rule cannot be talked out
  of its answer.

## v0.1
Two tools, `agent-task` profile only, deterministic checks plus sampling, records
written and committed, running against one real autonomous queue. `sdlc-critical`
waits for v0.2.

## Public surface
- Repo public from the first commit, honestly labelled as an interface draft.
- ~~The `/tools/` page on the site and any post wait until it has caught something real.~~
  **CHANGED 2026-09-16, Pedram's call, over my objection.** The page shipped the same day
  with the entry tagged *Interface draft* and the no-implementation line on it, rather than
  waiting for a catch. The original reason still stands and is worth re-reading before the
  next one: announcing an unused tool is the demo this paper argues against. **A post still
  waits for a real catch.**
- Site section bar: public and installable, **and** backed by evidence. Two conditions,
  both required, or the page becomes a junk drawer.
- No competitor is named anywhere, in the repo or on the site.
- No support commitment, no roadmap, stated plainly in both places.

## Evidence and kill check
- Every real catch goes in `CATCHES.md`, one line. Blocks and overrides are volume
  metrics and tell you little; a caught omission that would have shipped is a receipt.
- **31 January 2027:** if it is not in use and no advisory conversation has asked for
  the artifact, this stops being a product line and becomes a figure in the REJ paper.

## Deliberately excluded
- Signing and hash chaining. Git history already gives tamper evidence here.
- A spec generator, a plan mode, a clarifying-questions bot. Occupied, free, and not
  where the gap is.
- Dogfooding as research evidence. n equals one, on the author's own code.
- The tool as a contribution in the REJ extension. One availability line, no more.
