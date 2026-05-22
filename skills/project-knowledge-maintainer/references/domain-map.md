# OCKB Domain Map

Use these domains as routing domains for Chief and Planner work. Formal output remains under `docs/`.

| Domain | Evidence scope | Canonical targets |
|---|---|---|
| `Architecture` | root manifests, module layout, build files, framework config, existing architecture docs | `docs/code/architecture.md`, `docs/code/modules.md`, `docs/code/index.md` |
| `API` | controllers, routers, OpenAPI/Swagger, protobuf, GraphQL schemas, DTOs, event producers/consumers | `docs/api/http.md`, `docs/api/events.md`, `docs/integrations/*.md` |
| `Data` | DDL, migrations, ORM entities, repositories, mappers, SQL, schema tests | `docs/data/index.md`, `docs/data/schema.md`, `docs/data/tables/*.md`, `docs/data/transactions.md` |
| `BusinessFlow` | service/use-case code, jobs, listeners, state machines, business tests | `docs/domain/flows/index.md`, `docs/domain/flows/*.md`, `docs/domain/state-machines/*.md`, `docs/domain/rules.md` |
| `AgentTooling` | shell scripts, Python/Ruby/Node utilities, Makefile targets, task runners, internal CLI commands | `docs/ops/tools.md`, `docs/agent/tool-context.md`, `docs/agent/code-search.md` |
| `InfraEnv` | Dockerfile, compose, Kubernetes/Helm, CI, environment templates, config files | `docs/ops/dependencies.md`, `docs/ops/config/index.md`, `docs/ops/config/*.md`, `docs/dev/local-dev.md`, `docs/dev/test.md` |
| `MaintenanceOps` | troubleshooting notes, logs, exceptions, monitoring, runbooks, manual operations | `docs/ops/maintenance/*.md`, `docs/ops/manual-operations.md`, `docs/diagnosis/index.md`, `docs/diagnosis/*.md` |
| `Triage` | `.kb_inbox/`, imported notes, mixed operational findings awaiting classification | usually reroute into `MaintenanceOps` or an evidence-backed domain target |

## Routing Notes

- Prefer current owner mappings from `knowledge-map` over domain heuristics when both are available.
- Prefer data and infra updates before API and business-flow docs when the same evidence affects both.
- Prefer business-flow docs over endpoint catalogs when source evidence shows end-to-end state or table changes.
- Prefer diagnosis or runbook docs only when evidence supports actionable steps, queries, or decision criteria.
- Prefer `skip` or `defer` over forced updates when the change does not improve future understanding or actionability.
- Use Mermaid fenced blocks for nontrivial flows or state machines when source evidence supports the flow.
- Include an evidence section in every substantive docs page. Name it `## Evidence and Boundaries` unless the repository already uses Chinese headings, in which case use `## 证据与边界`.

## Data and SQL Guidance

- Route broad DDL or multi-table migration changes to `docs/data/schema.md` first.
- Route stable single-table semantics to `docs/data/tables/*.md` when the repository already uses table-level pages.
- Route transaction boundaries, locking behavior, cross-table write sequences, and rollback semantics to `docs/data/transactions.md`.
- Route ORM/entity changes with no behavioral or schema meaning to `defer` or `skip` unless an existing doc would become wrong without the update.
- Pure SQL formatting, comment churn, generated query artifacts, or trivial mapper renames are usually `skip`.
- Small durable SQL-related naming or helper changes that do not alter schema meaning or operational behavior are usually `defer`.
- If SQL or migration evidence changes HTTP contracts, event payloads, or end-to-end business rules, run `Data` before `API` and `BusinessFlow`.
- If migration evidence changes deploy order, feature flags, backfill steps, or operational safety, run `Data` before `InfraEnv` or `MaintenanceOps`.
