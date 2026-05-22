# OCKB Domain Map

Use these domains as logical classification labels. Formal output remains under `docs/`.

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
- Use Mermaid fenced blocks for nontrivial flows or state machines when source evidence supports the flow.
- Include an evidence section in every substantive docs page. Name it `## Evidence and Boundaries` unless the repository already uses Chinese headings, in which case use `## 证据与边界`.
