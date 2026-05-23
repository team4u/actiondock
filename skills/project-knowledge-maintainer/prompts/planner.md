# Planner Prompt

Create the plan. When document_set_plan_required is true, create Plan A first.

You must not delegate document discovery to Workers. Workers execute planned targets.

Return:

- Plan A document set, if required
- Plan B task plan
- domain coverage
- evidence basis
- phases
- delegate assignments

Prefer over-complete Plan A with `candidate`, `defer`, or `excluded` entries over underplanning.
