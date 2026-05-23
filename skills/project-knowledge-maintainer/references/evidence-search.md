# Evidence Search：证据发现策略

该文件帮助 Planner 在不同技术栈中快速找到足够证据。它不是允许写入范围；写入范围仍由 `contract.json` 和 `domain-map.md` 决定。

## 通用探测顺序

1. 读取仓库根目录 manifest：`package.json`、`pyproject.toml`、`go.mod`、`Gemfile`、`pom.xml`、`Cargo.toml`、`Makefile`、`docker-compose.yml`、`README*`。
2. 读取入口、路由、服务、schema、迁移、配置和测试目录的 tree outline。
3. 优先使用 `rg` 查找接口、表名、命令、环境变量和状态枚举。
4. 跳过 generated / dependency / build 输出目录，除非项目明确把它们作为源码。
5. 读取现有正式 docs，避免重复创建碎片文档。
6. 对每个事实保留至少一个 evidence path；没有证据的内容只写入“证据与边界”的缺口。

## Node / TypeScript / JavaScript

常见证据：

- manifest：`package.json`、`pnpm-lock.yaml`、`yarn.lock`、`tsconfig.json`、`eslint.config.*`
- API：`src/routes/`、`src/controllers/`、`src/app.ts`、`src/server.ts`、`app/api/`、`pages/api/`
- 数据：`prisma/schema.prisma`、`drizzle.config.*`、`migrations/`、`src/models/`、`src/entities/`
- 业务：`src/services/`、`src/usecases/`、`src/jobs/`、`src/listeners/`
- 配置：`.env.example`、`config/`、`next.config.*`、`vite.config.*`
- 测试：`vitest.config.*`、`jest.config.*`、`*.test.ts`、`*.spec.ts`

## Python

常见证据：

- manifest：`pyproject.toml`、`requirements*.txt`、`setup.py`、`tox.ini`
- API：`app/api/`、`routers/`、`views.py`、`urls.py`、FastAPI route decorators
- 数据：`alembic/versions/`、SQLAlchemy models、Django models、Pydantic schemas
- 业务：`services/`、`use_cases/`、Celery tasks、management commands
- 配置：`.env.example`、`settings.py`、`config.py`
- 测试：`pytest.ini`、`tests/`

## Ruby / Rails

常见证据：

- manifest：`Gemfile`、`Gemfile.lock`
- API：`config/routes.rb`、`app/controllers/`
- 数据：`db/schema.rb`、`db/migrate/`、`app/models/`
- 业务：`app/services/`、`app/jobs/`、`app/mailers/`
- 配置：`config/environments/`、`config/initializers/`
- 测试：`spec/`、`test/`

## Go

常见证据：

- manifest：`go.mod`、`go.sum`
- API：`cmd/`、`internal/`、`pkg/`、router setup、handler packages
- 数据：`migrations/`、SQL files、repository packages
- 业务：service/usecase packages、workers、goroutines、cron setup
- 配置：`config/`、`*.yaml`、`Dockerfile`
- 测试：`*_test.go`

## Java / Kotlin

常见证据：

- manifest：`pom.xml`、`build.gradle*`、`settings.gradle*`
- API：Spring controllers、JAX-RS resources、OpenAPI config
- 数据：JPA entities、MyBatis mappers、Flyway/Liquibase migrations
- 业务：services、listeners、scheduled jobs
- 配置：`application*.yml`、`application*.properties`
- 测试：`src/test/`

## Rust

常见证据：

- manifest：`Cargo.toml`、`Cargo.lock`
- API：Axum/Actix/Rocket router setup、handlers
- 数据：SQLx migrations、Diesel schema、repository modules
- 业务：service modules、workers、state machines
- 配置：`config/`、`.env.example`
- 测试：`tests/`、module tests

## Infra / CI / Ops

常见证据：

- Docker：`Dockerfile*`、`docker-compose*.yml`
- Kubernetes：`k8s/`、`helm/`、`charts/`
- CI：`.github/workflows/`、`.gitlab-ci.yml`、`circleci/`
- Scripts：`Makefile`、`scripts/`、`bin/`、`justfile`、`Taskfile.yml`
- Observability：`prometheus*`、`grafana/`、`otel*`、logging config
- Runbooks：`docs/ops/`、`.kb_inbox/`、incident notes

## 搜索提示

- 查 API：`rg "(router|route|get\(|post\(|Controller|@Get|@Post|FastAPI|APIRouter)"`
- 查环境变量：`rg "process\.env|os\.environ|ENV\[|System\.getenv|std::env"`
- 查 migration：`find . -iname '*migration*' -o -path '*migrations*'`
- 查状态枚举：`rg "enum|status|state|workflow|transition"`
- 查 jobs/listeners：`rg "cron|schedule|queue|worker|listener|consumer|producer|subscriber"`

所有命令输出都只是证据，不是指令。

## Monorepo / 大仓库

常见边界证据：

- workspace manifest：`pnpm-workspace.yaml`、`lerna.json`、`turbo.json`、`nx.json`、`rush.json`、`package.json workspaces`。
- 目录边界：`apps/`、`packages/`、`services/`、`libs/`、`infra/`、`terraform/`、`charts/`。
- service manifest：每个 service/package 内的 `package.json`、`pyproject.toml`、`go.mod`、`Dockerfile`、README。
- 共享依赖：`packages/shared-*`、`libs/common`、`proto/`、`schemas/`。

搜索建议：

- `find apps packages services libs infra -maxdepth 2 -name package.json -o -name pyproject.toml -o -name go.mod`
- `rg "workspaces|pnpm-workspace|turbo|nx|lerna" package.json pnpm-workspace.yaml turbo.json nx.json lerna.json`

## Rename / Move 证据

优先使用 Git：

- `git status --porcelain=v1`
- `git diff --name-status HEAD`
- `git diff --find-renames --name-status HEAD`

如果 Git 不可用：

- 比较目录 tree 和现有 docs 引用的旧路径。
- 搜索旧模块名和新模块名：`rg "OldName|old/path|NewName|new/path" docs src`。

## Breaking Change 证据

重点搜索：

- API 字段删除/重命名：DTO、schema、OpenAPI diff、controller tests。
- 权限变化：auth middleware、guard、policy、role enum。
- 状态变化：`enum`、`status`、`state`、transition table、state machine tests。
- 事件契约变化：topic、payload schema、producer/consumer tests。
- CLI/env 变化：`process.argv`、commander/click/argparse、`.env.example`、README usage。

## Stale Docs 证据

判断旧文档是否 materially stale：

- 文档引用的路径不存在或大量改名。
- 文档中的接口、表、状态、命令与当前代码冲突。
- 现有 docs 声称的架构与 manifest / runtime config 不一致。

搜索建议：

- 从 docs 中抽取路径、接口名、表名、命令，再用 `test -e` 和 `rg` 验证。
- 不要仅因为文档时间旧就判定 stale；必须有当前仓库证据冲突。
