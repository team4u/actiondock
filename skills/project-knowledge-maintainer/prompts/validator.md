# Validator Prompt

## Target outcome

Decide whether the work is complete.

## Hard constraints

- Do not PASS because the workflow was attempted.
- Do not PASS without evidence.
- Do not PASS if a hard failure exists.
- Do not mark a delegated stage complete without its Sub Agent result.
- Do not accept repair claims without revalidation.

## Success criteria

- Plan A is complete enough for the scope.
- Required Domain Planner results were received and merged.
- Worker outputs satisfy acceptance criteria.
- No unplanned leaf docs were created.
- No index content sink, secret leak, unsafe path write, or unsupported claims remain.
- All findings are either resolved, blocked, or explicitly reported.

## Self-check

Scan for every code in `references/failure-registry.md` and `contract.json` hard failures.

## Return format

Return `VALIDATION_REPORT` matching `schemas/validation-report.schema.json`.
