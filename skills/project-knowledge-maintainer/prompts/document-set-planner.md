# Document Set Planner Prompt

Produce a complete expected document set.

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

- coverage_basis
- coverage_assertion
- scope_boundary
- excluded_candidates

Do not output vague instructions such as “workers will add docs as needed.”
