# Scenario Matrix

| Scenario | Scale | Required protocol notes |
|---|---:|---|
| typo, link, one-line env note | XS | Route-lite, apply, validate-lite |
| update one existing leaf doc | S | Mini plan; no Plan A unless split risk appears |
| API plus data note | M | Task plan; enable Plan A if new leaf docs are needed |
| new API resource with business flow | L | Plan A required; delegate Workers by target path |
| monorepo refresh / large ingest | XL | Workspace scan, noise filter, Plan A, phased execution |
| index has substantial content | M/L | Split to leaf docs; validator checks `index_content_sink` |
| Planner lists only one or two docs but scope implies many | L/XL | hard failure: `planner_underplanning` |
| Worker asked to discover missing docs | M/L/XL | hard failure: `delegated_discovery_to_worker` |
| team agent pending and leader self-completes | any delegated | hard failure: `delegate_wait_bypassed` |
| Validator not run | any | hard failure: `validator_not_run` |

Use `candidate`, `defer`, and `excluded` entries in Plan A to avoid underplanning while controlling execution cost.
