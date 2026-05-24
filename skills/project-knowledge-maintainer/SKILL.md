---
name: project-knowledge-maintainer
version: 5.2.1
release: quality-pass-subagents
summary: Repository-backed project knowledge maintainer with lean runtime loading, Sub Agent delegation, Domain Planner Plan A, success loops, formatter, and validator gates.
description: Use when maintaining, rebuilding, validating, or ingesting repository-backed project knowledge bases, including ACTIONDOCK.md, docs/, and .kb_inbox/. Do not use for ordinary code edits unless the task changes project knowledge docs.
---

# Project Knowledge Maintainer

Maintain project knowledge from repository evidence. The goal is not to perform a fixed sequence of actions; the goal is to reach a validated knowledge-base state.

## Runtime hot path

Read these before acting:

1. `references/contract.json` — canonical controls, hard failure codes, runtime load map, and version.
2. `references/formatter.md` — required output and document formatting.
3. `references/playbook.md` — scale routing and protocol selection.

Always enforce the hard controls summarized in `contract.json`. Load detailed references only when the active stage requires them or when there is ambiguity.

## Stage-specific loading

| Stage | Load when needed |
|---|---|
| Safety / evidence uncertainty | `references/hard-safety.md`, `references/evidence-priority.md` |
| Delegation / fallback uncertainty | `references/execution-modes.md`, `references/delegate-gates.md` |
| Domain / Plan A work | `references/domain-planning.md`, `references/document-set-planning.md`, `protocols/plan-a-validation.md` |
| Worker execution | `references/worker.md`, `prompts/worker.md`, `schemas/worker-result.schema.json` |
| Validation / repair | `references/validator.md`, `references/failure-registry.md`, `protocols/repair-loop.md` |
| Quality audit | `references/self-audit.md` |

Role prompts and schemas are loaded per stage. Examples are eval fixtures only; do not load them during normal runs unless debugging or validating the skill package.

## Core rules

1. A stage is not complete because an action was attempted. It is complete only when success criteria are satisfied by evidence and validation.
2. Planner owns document discovery. Worker owns execution of planned documents.
3. Use `subagent > serial`; serial is a fallback, not a convenience mode.
4. If a stage is delegated to a Sub Agent, wait for its explicit result before advancing.
5. Validator decides completion. Leader confidence is not completion.

## Completion

Final completion requires Validator `PASS`, or an explicit `BLOCKED` / `FAILED` report with unresolved findings and next actions.
