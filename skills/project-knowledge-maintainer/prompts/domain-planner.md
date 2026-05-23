# Domain Planner Prompt

Create a detailed document inventory for exactly one canonical knowledge domain.

Do not write docs. Do not create Worker tasks. Do not defer discovery to Workers.

Return JSON matching `schemas/domain-plan.schema.json`.

Required behavior:

- scan evidence relevant to the assigned domain
- identify concrete domain entities, not just generic topics
- propose leaf docs for each substantial entity group
- use `candidate`, `defer`, and `excluded` instead of omitting plausible docs
- mark `thin_plan_risk=true` if the domain is active but the plan contains only broad overview/index docs
- include open questions and evidence gaps

A useful domain plan is usually more detailed than the final merged Plan A because the Global Planner may de-duplicate later. Under-enumeration is worse than over-enumeration.
