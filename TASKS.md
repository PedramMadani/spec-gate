# spec-gate — tasks

> v0.1 floor, set 2026-09-16. Decisions in `DECISIONS.md`. Evidence in `CATCHES.md`.
> Kill check **31 Jan 2027**.

| ID | Task | Status |
|---|---|---|
| `SG-01` | Interface, profile and record schema written | `[x]` 2026-09-16 |
| `SG-02` | Repo public, README honest about status | `[x]` 2026-09-16 |
| `SG-03` | MCP server skeleton (TypeScript), two tools registered, `npx` runnable | `[x]` 2026-09-16 |
| `SG-04` | `.spec-gate.yml` config resolution: profile by repo and path, caller cannot override | `[x]` 2026-09-16 |
| `SG-05` | Deterministic checks for `test_contract` and `blast_radius`, with the veto | `[x]` 2026-09-16 |
| `SG-06` | Declared scoring against the rubric with rule veto (done); external scorer configurable (open); scorer identity recorded; independent scorer configurable. **Not sampling:** deprecated in spec 2026-07-28 and unsupported in Claude Code, Cursor and Codex | `[ ]` |
| `SG-07` | `write_record`: JSON validated against the schema, content hash, Markdown sibling | `[x]` 2026-09-16 |
| `SG-08` | Override path: reason mandatory, blocks without one | `[x]` 2026-09-16 |
| `SG-09` | Tests assert on the stored record, never on stdout | `[x]` 2026-09-16 (34 tests) |
| `SG-15` | Shadow mode: allow, but log what it would have blocked | `[x]` 2026-09-16 |
| `SG-10` | Wire into the Legalithm Ralph worktree **in shadow mode**, leave it running a week | `[ ]` |
| `SG-16` | Read the shadow log and decide: enforce, retune the profile, or drop it | `[ ]` |
| `SG-11` | First catch logged in `CATCHES.md` | `[ ]` |
| `SG-12` | Elicitation for blocking questions (Claude Code, Cursor, VS Code, Codex all support it) | `[ ]` |
| `SG-13` | **PreToolUse hook**: edits denied without a fresh authorising record | `[x]` 2026-09-16 |
| `SG-14` | Hook covers Bash-driven writes, not just Edit/Write | `[ ]` |

## Not now
- `sdlc-critical` profile (v0.2)
- Anything on the site, until `SG-11`
