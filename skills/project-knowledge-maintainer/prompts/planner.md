# Planner Prompt

Create the plan. When document_set_plan_required is true, run domain-partitioned planning before Plan A: assign one Domain Planner per activated or plausible domain, wait for the results, merge them into Plan A, then derive Plan B.

You must not delegate document discovery to Workers. Workers execute planned targets.

Return:

- domain_planner_assignments, if Plan A is required
- domain_plan_results or result references
- domain merge decisions
- Plan A document set, if required
- Plan B task plan
- domain coverage
- evidence basis
- phases
- delegate assignments

Prefer over-complete domain inventories and Plan A entries with `candidate`, `defer`, or `excluded` over underplanning. A broad plan with only one or two target files is invalid unless supported by explicit domain results.
