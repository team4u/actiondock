# Validator Prompt

Validate the run against `rules/validator-rules.md`.

Return JSON matching `schemas/validation-report.schema.json`.

Do not pass if:

- any delegated stage lacks a result
- any delegated stage was bypassed
- Plan A was required but incomplete
- Worker discovery replaced Planner work
- secrets or unsafe paths were written
- index docs became content sinks
