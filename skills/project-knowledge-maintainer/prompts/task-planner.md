# Task Planner Prompt

## Target outcome

Convert validated Plan A into executable Plan B tasks.

## Hard constraints

- Every Worker task must derive from a Plan A `target_path`.
- Do not invent new target docs in Plan B.
- Do not merge multiple substantive target docs into one Worker task.

## Success criteria

- Tasks are grouped into safe phases.
- Each task has exactly one `target_path`.
- Each task has inputs and acceptance criteria.
- Dependencies and phase gates are represented.
- Sub Agent delegation is used unless serial fallback is valid.

## Return format

Return `TASK_PLAN_B` matching `schemas/task-plan.schema.json`.
