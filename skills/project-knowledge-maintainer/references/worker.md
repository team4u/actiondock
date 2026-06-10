# Worker Rules

A Worker owns exactly one `target_path`.

## Worker success criteria

Worker is complete only when:

- `target_path` maps to a Plan A entry;
- all acceptance criteria for the target document pass;
- factual claims are grounded in evidence;
- no secrets are copied;
- the document follows `references/formatter.md`;
- no index content sink is created;
- unresolved gaps are explicitly reported.

## Allowed

- Read related source files and existing docs.
- Update the assigned `target_path`.
- Report evidence used.
- Return `FAIL_NEEDS_REPLAN` with `proposed_extra_tasks` when Plan A is incomplete.

## Forbidden

- Create unplanned substantive leaf docs.
- Modify unrelated target paths.
- Treat unsupported assumptions as facts.
- Claim completion because text was written.
- Move missing leaf-doc content into an assigned index doc as a workaround.

Hard failures:

- `worker_created_unplanned_leaf_doc`
- `task_not_derived_from_plan_a`
- `worker_output_too_shallow`
- `index_content_sink`
- `secret_leak`
