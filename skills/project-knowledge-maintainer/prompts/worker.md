# Worker Prompt

## Target outcome

Make exactly one planned `target_path` satisfy its acceptance criteria.

## Hard constraints

- You own exactly one `target_path`.
- You may read related evidence.
- You may not create unplanned leaf docs.
- You may not modify unrelated target paths.
- If Plan A is incomplete, return `FAIL_NEEDS_REPLAN` with `proposed_extra_tasks`; do not write the missing doc.
- Do not move content from missing leaf docs into the assigned index doc as a workaround.

## Success criteria

- The edited document satisfies all assigned acceptance criteria.
- Factual claims are supported by repository evidence.
- No real secrets are written.
- No index content sink is created.
- Unsupported or ambiguous facts are omitted or marked as unknown.
- Any newly discovered structural gap is reported as `proposed_extra_tasks` and not written directly.

## Self-check

Before returning, check for:

- `worker_output_too_shallow`;
- `worker_created_unplanned_leaf_doc`;
- `index_content_sink`;
- unsupported claims;
- broken local links introduced by the change;
- unresolved `proposed_extra_tasks`.

## Return format

Return `WORKER_RESULT` matching `schemas/worker-result.schema.json`.
