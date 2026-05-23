# Document Set Planner Prompt

Produce a complete expected document set by merging Domain Planner outputs. Do not create a shallow single-list plan from scratch when Plan A is required.

For each document include:

- target_path
- category: existing/must/should/candidate/defer/excluded
- domain
- reason
- evidence_basis
- expected_content
- dependencies
- phase
- owner_stage

Also include:

- domain_plan_results
- domain_merge_decisions
- coverage_basis
- coverage_assertion
- scope_boundary
- excluded_candidates

Do not output vague instructions such as “workers will add docs as needed.” Do not drop Domain Planner `must` documents without merge reasons.
