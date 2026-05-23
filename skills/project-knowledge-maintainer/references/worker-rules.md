# Worker Rules

A Worker is a delegated or serial execution unit for a planned target.

## One target per Worker

Each substantive Worker must have exactly one `target_path`. This prevents broad, unsupervised edits and enables validation.

Allowed exceptions:

- scan-only Worker
- validation-only Worker
- integration Worker that only updates navigation links and does not create new substantive content
- mechanical rename/move Worker approved by the task plan

## Worker may read broadly

A Worker may read related source files, tests, schemas, existing docs, and neighboring docs to produce an accurate target file.

## Worker may not replace Planner

A Worker must not create unplanned substantive leaf docs. If additional docs are needed, return `proposed_extra_tasks` and `NEEDS_REPLAN`.

## Worker output

A Worker result must include:

- `status`
- `target_path`
- `files_changed`
- `evidence_used`
- `summary`
- `risks`
- `proposed_extra_tasks`
- `validation_notes`

## Acceptance criteria

Worker output must satisfy the task's acceptance criteria and remain within its target path unless explicitly authorized.
