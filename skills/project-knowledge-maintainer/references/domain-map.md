# OCKB Domain Map

Use these domains exactly as routing domains for Chief and Planner work. Formal output remains under `docs/`.

| Domain | Evidence scope | Canonical targets |
|---|---|---|
| `Chief_Architect` | root manifests, module layout, build files, framework config, architecture docs, cross-domain summaries | `docs/code/architecture.md`, `docs/code/modules.md`, `docs/code/index.md` |
| `API_Spec_Planner` | controllers, routers, OpenAPI/Swagger, protobuf, GraphQL schemas, DTOs, event producers/consumers | `docs/api/http.md`, `docs/api/events.md`, `docs/integrations/*.md` |
| `Data_Model_Planner` | DDL, migrations, ORM entities, repositories, mappers, SQL, schema tests | `docs/data/index.md`, `docs/data/schema.md`, `docs/data/tables/*.md`, `docs/data/transactions.md` |
| `Business_Flow_Planner` | service/use-case code, jobs, listeners, state machines, business tests | `docs/domain/flows/index.md`, `docs/domain/flows/*.md`, `docs/domain/state-machines/*.md`, `docs/domain/rules.md` |
| `Agent_Tool_Planner` | shell scripts, Python/Ruby/Node utilities, Makefile targets, task runners, internal CLI commands, agent-facing workflows | `docs/ops/tools.md`, `docs/agent/tool-context.md`, `docs/agent/code-search.md` |
| `Infra_Env_Planner` | Dockerfile, compose, Kubernetes/Helm, CI, environment templates, config files | `docs/ops/dependencies.md`, `docs/ops/config/index.md`, `docs/ops/config/*.md`, `docs/dev/local-dev.md`, `docs/dev/test.md` |
| `Maintenance_Ops_Planner` | troubleshooting notes, logs, exceptions, monitoring, runbooks, manual operations | `docs/ops/maintenance/*.md`, `docs/ops/manual-operations.md`, `docs/diagnosis/index.md`, `docs/diagnosis/*.md` |
| `Triage_Planner` | `.kb_inbox/`, imported notes, mixed operational findings awaiting classification | usually reroute into `Maintenance_Ops_Planner` or an evidence-backed domain target |

## Routing Notes

- Prefer current owner mappings from `knowledge-map` over domain heuristics when both are available and not stale.
- Prefer data and infra updates before API and business-flow docs when the same evidence affects both.
- Prefer business-flow docs over endpoint catalogs when source evidence shows end-to-end state, policy, or table changes.
- Prefer diagnosis or runbook docs only when evidence supports actionable steps, queries, symptoms, or decision criteria.
- Prefer `skip` or `defer` over forced updates when the change does not improve future understanding or actionability.
- Use Mermaid fenced blocks for nontrivial flows or state machines when source evidence supports the flow.
- Include an evidence section in every substantive docs page. Name it `## Evidence and Boundaries` unless the repository already uses another language or established heading convention.

## Data and SQL Guidance

- Route broad DDL or multi-table migration changes to `docs/data/schema.md` first.
- Route stable single-table semantics to `docs/data/tables/*.md` when the repository already uses table-level pages.
- Route transaction boundaries, locking behavior, cross-table write sequences, and rollback semantics to `docs/data/transactions.md`.
- Route ORM/entity changes with no behavioral or schema meaning to `defer` or `skip` unless an existing doc would become wrong without the update.
- Pure SQL formatting, comment churn, generated query artifacts, or trivial mapper renames are usually `skip`.
- Small durable SQL-related naming or helper changes that do not alter schema meaning or operational behavior are usually `defer`.
- If SQL or migration evidence changes HTTP contracts, event payloads, or end-to-end business rules, run `Data_Model_Planner` before `API_Spec_Planner` and `Business_Flow_Planner`.
- If migration evidence changes deploy order, feature flags, backfill steps, or operational safety, run `Data_Model_Planner` before `Infra_Env_Planner` or `Maintenance_Ops_Planner`.
