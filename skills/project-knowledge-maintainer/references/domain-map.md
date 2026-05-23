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
