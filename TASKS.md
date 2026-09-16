# spec-gate — tasks

> v0.1 floor, set 2026-09-16. Decisions in `DECISIONS.md`. Evidence in `CATCHES.md`.
> Kill check **31 Jan 2027**.

| ID | Task | Status |
|---|---|---|
| `SG-01` | Interface, profile and record schema written | `[x]` 2026-09-16 |
| `SG-02` | Repo public, README labelled interface draft | `[ ]` |
| `SG-03` | MCP server skeleton (TypeScript), two tools registered, `npx` runnable | `[x]` 2026-09-16 |
| `SG-04` | `.spec-gate.yml` config resolution: profile by repo and path, caller cannot override | `[x]` 2026-09-16 |
| `SG-05` | Deterministic checks for `test_contract` and `blast_radius` | `[ ]` |
| `SG-06` | Declared scoring against the rubric with rule veto; scorer identity recorded; independent scorer configurable. **Not sampling:** deprecated in spec 2026-07-28 and unsupported in Claude Code, Cursor and Codex | `[ ]` |
| `SG-07` | `write_record`: JSON validated against the schema, content hash, Markdown sibling | `[ ]` |
| `SG-08` | Override path: reason mandatory, blocks without one | `[ ]` |
| `SG-09` | Tests assert on the stored record, never on stdout | `[ ]` |
| `SG-10` | Wire into one real autonomous queue and leave it running | `[ ]` |
| `SG-11` | First catch logged in `CATCHES.md` | `[ ]` |
| `SG-12` | Elicitation for blocking questions (Claude Code, Cursor, VS Code, Codex all support it) | `[ ]` |

## Not now
- `sdlc-critical` profile (v0.2)
- Anything on the site, until `SG-11`
