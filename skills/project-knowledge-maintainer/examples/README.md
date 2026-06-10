# Eval Fixtures

Examples are package evaluation fixtures, not runtime instructions.

Use them to test whether the skill blocks known failure modes such as shallow planning, missing Sub Agent results, invalid repair claims, Validator PASS without evidence, and Global Planner inventory compression.

## Fixtures

- `delegate-wait-gate`: delegated stage result is missing.
- `domain-plan-too-shallow`: Domain Planner returns a shallow inventory.
- `domain-planner-fanout`: valid domain-plan fixture for API fan-out.
- `global-planner-compressed-inventory`: Global Planner compresses Domain Planner inventories into index-only docs.
- `index-content-sink`: content that should be split into leaf docs is collapsed into an index.
- `missing-infra-env-doc`: env/config evidence exists but infra/env docs are missing.
- `plan-a-only-index-docs`: Plan A has only index docs despite leaf evidence.
- `planner-underplanning`: Plan A is too shallow for multi-domain evidence.
- `repair-claimed-without-revalidation`: repair is claimed without a follow-up validation report.
- `subagent-pending-leader-self-completes`: leader completes a delegated stage before result arrives.
- `success-loop-repair`: repair-plan fixture.
- `validator-pass-without-evidence`: Validator PASS without evidence.
- `worker-created-unplanned-doc`: Worker creates an unplanned leaf document.
