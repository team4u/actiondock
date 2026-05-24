# Task Planner Prompt

## Target outcome

Convert validated Plan A into executable Plan B tasks.

Plan B schedules execution; it does not rediscover or redesign the document set.

## Execution scope policy

Default execution includes:

- `existing`
- `must`
- `should`

High-coverage, repair, or explicit user scope may additionally include evidenced `candidate` documents.

Do not execute `defer` or `excluded` documents unless a new Plan A reclassifies them.

## Hard constraints

- Every Worker task must derive from a Plan A `target_path`.
- Do not invent new target docs in Plan B.
- Do not merge multiple substantive target docs into one Worker task.
- Do not silently skip `must` or `should` documents.
- Do not schedule `candidate` documents in default mode unless the user explicitly requested high coverage or repair scope.

## Success criteria

- Tasks are grouped into safe phases.
- Each task has exactly one `target_path`.
- Each task has inputs and acceptance criteria.
- Dependencies and phase gates are represented.
- All `existing`, `must`, and `should` Plan A documents are scheduled or explicitly listed as blocked/skipped with reason.
- Sub Agent delegation is used unless serial fallback is valid.

## Return format

Return `TASK_PLAN_B` matching `schemas/task-plan.schema.json`.
