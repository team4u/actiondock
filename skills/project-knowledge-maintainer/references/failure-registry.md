# Failure Registry

These hard failures block Validator `PASS` unless explicitly terminal as `BLOCKED` or `FAILED` with evidence.

## Planning failures

- `planner_underplanning`
- `domain_planner_missing`
- `domain_plan_result_missing`
- `domain_doc_inventory_too_shallow`
- `domain_plan_not_merged`
- `global_planner_compressed_inventory`
- `should_doc_dropped_without_reason`
- `shallow_global_plan`
- `missing_required_leaf_doc`
- `active_domain_index_only`
- `delegated_discovery_to_worker`

## Execution failures

- `worker_created_unplanned_leaf_doc`
- `task_not_derived_from_plan_a`
- `plan_b_skipped_should_without_reason`
- `candidate_executed_without_high_coverage_scope`
- `worker_output_too_shallow`
- `index_content_sink`
- `category_under_split`

## Delegate failures

- `delegate_result_missing`
- `delegate_wait_bypassed`
- `leader_self_completed_dispatched_stage`

## Safety failures

- `secret_leak`
- `unsafe_path_write`
- `repo_text_used_as_instruction`

## Validation / repair failures

- `validator_not_run`
- `validator_pass_without_evidence`
- `repair_claimed_without_validation`
- `repair_claimed_without_revalidation`

## Quality-pass hard failures

- `domain_plan_too_shallow`: a Domain Planner returns only broad docs despite leaf-level evidence.
- `plan_a_only_index_docs`: Plan A contains only index/overview docs while substantive leaf docs are required.
- `missing_infra_env_doc`: environment/config evidence exists but infra/env documentation is missing from Plan A.
- `subagent_pending_leader_self_completes`: the leader advances or completes a stage while its delegated Sub Agent result is pending.

## Coverage-expanded planning failures

- `global_planner_compressed_inventory`: Global Planner drops, merges, or defers documents mainly to reduce Worker count.
- `should_doc_dropped_without_reason`: a `should` document from a Domain Planner is missing from Plan A with no recorded merge decision.
- `active_domain_index_only`: an activated domain is represented only by index/overview docs despite leaf-level evidence.
- `plan_b_skipped_should_without_reason`: default Plan B does not schedule a `should` document and does not record a block/skip reason.
- `candidate_executed_without_high_coverage_scope`: Plan B schedules `candidate` documents while execution mode is default.
