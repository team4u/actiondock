# OCKB Domain Map

Use these OCKB domains as logical routing domains. Formal output remains under `docs/`.

Wildcard targets are target patterns only. A Planner must emit a concrete Markdown path such as `docs/data/tables/users.md`, never the wildcard pattern itself.

| OCKB base domain | Planner | Evidence scope | Formal targets |
|---|---|---|---|
| 01 Architecture Overview | `Architecture_Planner` | root manifests, module layout, build files, framework config, existing architecture docs | `docs/code/architecture.md`, `docs/code/modules.md`, `docs/code/index.md` |
| 02 API Specifications | `API_Spec_Planner` | controllers, routers, OpenAPI/Swagger, protobuf, GraphQL schemas, DTOs, event producers/consumers | `docs/api/http.md`, `docs/api/events.md`, `docs/integrations/*.md` |
| 03 Data Models | `Data_Model_Planner` | DDL, migrations, ORM entities, repositories, mappers, SQL, schema tests | `docs/data/index.md`, `docs/data/schema.md`, `docs/data/tables/*.md`, `docs/data/transactions.md` |
| 04 Business Flows | `Business_Flow_Planner` | service/use-case code, jobs, listeners, state machines, business tests | `docs/domain/flows/index.md`, `docs/domain/flows/*.md`, `docs/domain/state-machines/*.md`, `docs/domain/rules.md` |
| 05 Agent Tools and CLI | `Agent_Tool_Planner` | shell scripts, Python/Ruby/Node utilities, Makefile targets, task runners, internal CLI commands | `docs/ops/tools.md`, `docs/agent/tool-context.md`, `docs/agent/code-search.md` |
| 06 Infra and Env | `Infra_Env_Planner` | Dockerfile, compose, Kubernetes/Helm, CI, environment templates, config files | `docs/ops/dependencies.md`, `docs/ops/config/index.md`, `docs/ops/config/*.md`, `docs/dev/local-dev.md`, `docs/dev/test.md` |
| 07 Maintenance and Ops | `Maintenance_Ops_Planner`, `Triage_Planner` | `.kb_inbox/`, troubleshooting notes, logs, exceptions, monitoring, runbooks, manual operations | `docs/ops/maintenance/*.md`, `docs/ops/manual-operations.md`, `docs/diagnosis/index.md`, `docs/diagnosis/*.md` |
