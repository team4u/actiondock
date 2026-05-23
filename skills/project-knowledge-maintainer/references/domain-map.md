# Domain Map

Use these domains to organize project knowledge. All tasks should implicitly check whether each domain is relevant; only activated or materially skipped domains need explicit output for XS/S. L/XL should include a domain coverage matrix.

| Domain | Typical paths | Leaf doc examples |
|---|---|---|
| Architecture | `docs/code/`, `docs/architecture/` | `docs/code/architecture.md`, `docs/code/workspaces.md` |
| API | `docs/api/` | `docs/api/http/orders.md`, `docs/api/auth.md`, `docs/api/events/payment-events.md` |
| Data | `docs/data/` | `docs/data/tables/users.md`, `docs/data/migrations/status-lifecycle.md` |
| Business Flow | `docs/flows/` | `docs/flows/checkout.md`, `docs/flows/onboarding.md` |
| Agent / Tool | `docs/agents/`, `docs/tools/` | `docs/agents/support-bot.md`, `docs/tools/importer.md` |
| Infra / Env | `docs/infra/`, `docs/dev/` | `docs/infra/env.md`, `docs/dev/local-dev.md` |
| Maintenance / Ops | `docs/ops/`, `docs/runbooks/` | `docs/ops/deploy.md`, `docs/runbooks/payment-timeouts.md` |

Index pages should link to leaf docs and summarize status. Substantive content belongs in leaf docs.


## Domain Planner seed inventory

These are not mandatory files, but each Domain Planner must explicitly consider these shapes and either include, defer, candidate-list, or exclude them.

| Domain | Consider at least | Typical split signal |
|---|---|---|
| Architecture | overview, services/components, modules/workspaces, dependency map, runtime boundaries | multiple packages, services, queues, modules, adapters |
| API | index, auth, errors, endpoint groups, DTOs/schemas, events/webhooks | route files, controllers, OpenAPI specs, client SDKs |
| Data | index, schema overview, table/entity docs, migrations, lifecycle/status docs | migrations, ORM models, repositories, seeds |
| Business Flow | index, major flows, state machines, edge cases, failure/rollback paths | workflows, sagas, jobs, domain services, tests |
| Agent / Tool | index, each agent/tool, tool contracts, prompts/instructions, safety boundaries | agent configs, tools, prompts, MCP/actions, scripts |
| Infra / Env | index, local dev, env/config, deployment, secrets handling, external services | Docker, CI, IaC, env examples, deployment configs |
| Maintenance / Ops | index, runbooks, troubleshooting, observability, scheduled jobs, incident notes | cron/jobs, logging, alerts, operational scripts |

If evidence activates one of these areas but the Domain Planner proposes only an index/overview, it must set `thin_plan_risk=true` and explain why no leaf docs are currently justified.
