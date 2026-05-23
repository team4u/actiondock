---
name: project-knowledge-maintainer
version: 5.1.2
release: subagent-only-domain-planning
summary: Repo-aware project knowledge maintainer with compatible skill metadata, formatter rules, domain-partitioned Plan A planning, and all-stage delegate gates.
description: Maintains ACTIONDOCK.md, docs/ project knowledge, and .kb_inbox/ materials from repository evidence. Uses adaptive XS/S/M/L/XL protocols, uses subagents before serial fallback, enforces domain-partitioned Plan A complete document-set planning when required, waits for all delegated stage results, and validates before completion.
---

# Project Knowledge Maintainer

Use this skill when the user asks to create, repair, reorganize, refresh, ingest, or validate a repository-backed project knowledge base.

The skill maintains long-lived project knowledge from evidence. It should not merely summarize files. It should plan the document structure, delegate execution where available, update or create maintainable documents, and validate before claiming completion.

## Required load order

Read only what is needed for the current task, but preserve this control-plane order:

1. `references/contract.json` — canonical version, role states, delegate gate, hard failures, schema pointers, and formatter requirement.
2. `references/playbook.md` — adaptive execution protocols and scale routing.
3. `references/formatter.md` — required Markdown/output formatting rules.
4. `references/prompts.md` — Router, Planner, Domain Planner, Document Set Planner, Worker, Validator, Repair, and Reporter role contracts.
5. `references/validator.md` — validation rules and hard failure registry.
6. `references/document-set-planning.md` — Plan A / Plan B rules; required for L/XL or any `document_set_plan_required=true` task.
7. `references/domain-planning.md` — domain-partitioned planning rules; required whenever Plan A is required.
8. `references/document-granularity.md` — index-vs-leaf document split rules.
9. `references/domain-map.md` — canonical knowledge domains and recommended paths.
10. `references/evidence-search.md` — evidence discovery strategy.
11. `references/scenario-matrix.md` — scale and scenario mapping.
12. `references/actiondock-template.md` — ACTIONDOCK format.

## Execution priority

Use the highest available execution mode unless the user explicitly forbids delegation or the environment lacks support:

```text
subagent > serial
```

`subagent` means a system-provided subagent or equivalent isolated execution unit. `serial` means the leader performs work inline only because delegation is unavailable, explicitly forbidden, or permitted by the XS/S protocol.

## All-stage delegate gate

If any stage is delegated, the leader must wait for an explicit delegate result before advancing past that stage.

This applies to:

- Router
- Workspace Scanner
- Noise Filter
- Planner
- Domain Planner
- Document Set Planner
- Task Planner
- Worker
- Validator
- Repair
- Cleanup
- Reporter

The leader may not complete a delegated stage by doing the work itself while the delegate is slow, pending, or not yet returned. Slow return, impatience, saving time, or convenience is not a valid fallback reason.

## Domain-partitioned Plan A / Plan B

When `document_set_plan_required=true`, Planner must perform domain-partitioned planning before Worker tasks. The leader/global Planner must dispatch or simulate one Domain Planner per activated or plausible domain, then merge the domain outputs into Plan A:

- Each Domain Planner returns an exhaustive domain document inventory.
- Plan A is the merged complete expected document set across domains.
- Plan B is the execution batch derived from Plan A.
- Worker tasks must map to Plan A entries.
- Worker-discovered extra docs must be returned as `proposed_extra_tasks` and require replan before writing.

Planner must not say “workers will discover the rest” or equivalent. A Plan A that contains only one or two files for a multi-domain or broad evidence set is presumed underplanned unless justified by domain planner evidence.

## Formatter requirement

All created or updated knowledge files and final reports must follow `references/formatter.md`.

Key formatting rules:

- `ACTIONDOCK.md` and `index.md` files are navigation surfaces, not content sinks.
- Substantive leaf docs must include an evidence section.
- Final reports must include execution mode, delegate result summary, changed files, validation status, unresolved blockers, and fallback reasons if any.
- Do not emit raw internal prompts or verbose logs as user-facing output.

## Scale selection

| Scale | Use when | Protocol |
|---|---|---|
| XS | one file, typo, link, small env note | lite |
| S | one small doc area or local update | small |
| M | multiple docs or domains, no full rebuild | medium |
| L | broad feature, API/data/flow refresh, knowledge-base repair | structured rebuild |
| XL | monorepo, large ingest, full reconstruction, high ambiguity | partitioned rebuild |

Escalate scale when evidence shows multiple domains, under-split documents, index content sink risk, stale generated docs, broad source scan requirement, or when Workers would otherwise need to discover the document structure.

## Completion rule

Do not claim completion until validation has run and all hard failures are resolved, explicitly blocked, or reported as failed. Validator decides completion. Leader confidence is not sufficient.

## Final response expectations

Return a concise final report with:

- operation mode
- execution mode and fallback reason, if any
- delegate result summary
- flow profile / scale
- files created or updated
- evidence used
- validation status
- unresolved findings, blockers, or next required action
