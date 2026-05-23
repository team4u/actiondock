# Project Knowledge Maintainer

Use this skill when the user asks to create, repair, reorganize, refresh, or validate project knowledge documents from a repository, codebase, configuration set, database schema, API surface, tests, runbooks, or existing documentation.

## Core mandate

Maintain a project knowledge base from evidence. Do not merely summarize. Build or update a maintainable document structure with explicit planning, delegated execution where available, and validation before completion.

## Control plane

Read these files as the governing protocol:

1. `contract.json`
2. `rules/hard-safety.md`
3. `rules/evidence-priority.md`
4. `rules/execution-modes.md`
5. `rules/delegate-gates.md`
6. `rules/planner-plan-a.md`
7. `rules/worker-rules.md`
8. `rules/validator-rules.md`
9. `rules/document-granularity.md`

Then choose one protocol:

- `protocols/xs-lite.md`
- `protocols/small-task.md`
- `protocols/medium-task.md`
- `protocols/large-rebuild.md`
- `protocols/repair-loop.md`

## Execution priority

Use this priority order unless the user explicitly forbids delegation or the environment does not support it:

```text
team_agent > native_subagent > serial
```

`team_agent` means a dedicated team member, team task, team role, or equivalent external agent lane. `native_subagent` means a system-provided subagent or equivalent isolated execution unit. `serial` means the leader performs work inline only because delegation is unavailable or explicitly forbidden.

## All-stage delegate gate

If any stage is delegated, the leader must wait for an explicit delegate result before advancing past that stage. This applies to Router, Workspace Scanner, Noise Filter, Planner, Document Set Planner, Task Planner, Worker, Validator, Repair, Cleanup, and Reporter.

The leader may not complete a delegated stage by doing the work itself while the delegate is slow, pending, or not yet returned. Slow return, impatience, saving time, or convenience is not a valid fallback reason.

## Scale selection

Classify the task before planning:

| Scale | Use when | Protocol |
|---|---|---|
| XS | one file, typo, link, small env note | `xs-lite` |
| S | one small doc area or local update | `small-task` |
| M | multiple docs or domains, no full rebuild | `medium-task` |
| L | broad feature, API/data/flow refresh, knowledge-base repair | `large-rebuild` |
| XL | monorepo, large ingest, full reconstruction, high ambiguity | `large-rebuild` |

Escalate scale when evidence shows multiple domains, under-split documents, index content sink risk, stale generated docs, or a broad source scan requirement.

## Plan A / Plan B

When `document_set_plan_required=true`, Planner must produce Plan A before any Worker tasks:

- Plan A is the complete expected document set.
- Plan B is the execution batch derived from Plan A.
- Worker tasks must map to Plan A entries.
- Worker-discovered extra docs must be returned as `proposed_extra_tasks` and require replan before writing.

Planner must not say “workers will discover the rest” or equivalent.

## Completion rule

Do not claim completion until validation has run and all hard failures are either resolved, explicitly blocked, or reported as failed. Validator determines completion. Leader confidence is not sufficient.

## Output expectations

Final response or final report must include:

- files created or updated
- evidence used
- execution mode and fallback reasons, if any
- delegate result summary
- validation status
- unresolved findings or blockers
- next actions only when work is incomplete
