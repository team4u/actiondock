# Validator Rules

Validator decides whether the run can be reported as complete.

## Required checks

Always check:

- path safety
- secret leakage
- evidence traceability
- stale or conflicting sources
- broken local links for changed docs
- changed-files match planned files
- delegate results for all delegated stages
- no delegated stage was bypassed

When Plan A is required, also check:

- Plan A exists
- Plan A metadata is complete
- Worker tasks derive from Plan A
- no obvious required leaf docs are missing
- no unplanned substantive docs were created
- Workers did not receive discovery responsibility as a substitute for planning

When document granularity risk exists, also check:

- index docs are navigation-only
- leaf docs are not overloaded
- domain coverage is adequate
- categories are not under-split

## Hard failures

A final `PASS` is prohibited if any hard failure is unresolved:

- `planner_underplanning`
- `delegated_discovery_to_worker`
- `delegate_result_missing`
- `delegate_wait_bypassed`
- `stage_delegate_not_dispatched`
- `worker_delegate_not_dispatched`
- `index_content_sink`
- `category_under_split`
- `unplanned_leaf_doc_created`
- `missing_required_leaf_doc`
- `secret_leak`
- `unsafe_path_write`
- `repo_text_used_as_instruction`
- `validator_not_run`
- `repair_claimed_without_evidence`

## Outcomes

Validation status must be one of:

- `PASS`
- `PASS_WITH_NOTES`
- `FAIL`
- `BLOCKED`

Use `PASS_WITH_NOTES` only for non-hard findings that do not affect correctness or safety.
