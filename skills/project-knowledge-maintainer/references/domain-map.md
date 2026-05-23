# Domain Map：七个知识领域

这些 domain 是逻辑路由领域，正式输出仍在 `docs/` 下。表中的 wildcard 只是目标模式；Planner 必须输出具体 Markdown 路径，例如 `docs/data/tables/users.md`，不能输出 `docs/data/tables/*.md`。

| 领域 | Planner | 证据范围 | 正式目标 |
|---|---|---|---|
| 01 架构总览 | `Architecture_Planner` | 根 manifest、模块布局、build 文件、框架配置、现有架构文档 | `docs/code/architecture.md`, `docs/code/modules.md`, `docs/code/index.md` |
| 02 API 与集成契约 | `API_Spec_Planner` | controllers、routers、OpenAPI/Swagger、protobuf、GraphQL schema、DTO、事件生产/消费代码 | `docs/api/http.md`（入口）, `docs/api/http/*.md`, `docs/api/events.md`（入口）, `docs/api/events/*.md`, `docs/integrations/*.md` |
| 03 数据模型 | `Data_Model_Planner` | DDL、migration、ORM entity、repository、mapper、SQL、schema tests | `docs/data/index.md`（入口）, `docs/data/schema.md`, `docs/data/tables/*.md`, `docs/data/transactions/*.md` |
| 04 业务流程 | `Business_Flow_Planner` | service/use-case 代码、jobs、listeners、state machines、业务测试 | `docs/domain/flows/index.md`（入口）, `docs/domain/flows/*.md`, `docs/domain/state-machines/*.md`, `docs/domain/rules.md` |
| 05 Agent、工具与 CLI | `Agent_Tool_Planner` | shell scripts、Python/Ruby/Node utilities、Makefile、task runner、内部 CLI | `docs/ops/tools.md`, `docs/agent/tool-context.md`, `docs/agent/code-search.md` |
| 06 基础设施与环境 | `Infra_Env_Planner` | Dockerfile、compose、Kubernetes/Helm、CI、env templates、config files | `docs/ops/dependencies.md`, `docs/ops/config/index.md`（入口）, `docs/ops/config/*.md`, `docs/dev/local-dev.md`, `docs/dev/test.md` |
| 07 维护、运维与诊断 | `Maintenance_Ops_Planner` | `.kb_inbox/`、排障笔记、logs、exceptions、monitoring、runbooks、人工操作流程 | `docs/ops/maintenance/*.md`, `docs/ops/manual-operations.md`, `docs/diagnosis/index.md`（入口）, `docs/diagnosis/*.md` |

## 领域路由提示

- 数据模型和 infra 变更通常先于 API、业务流程和架构总览。
- API endpoint 变更不一定只更新 API 文档；如果影响状态流、表结构或异步事件，也要路由到 Data / Business Flow / Events。
- 业务流程文档优先描述端到端行为，不只是函数列表。
- Maintenance/Ops 只在证据支持可执行步骤、查询、决策标准或排障路径时写入 runbook/diagnosis。
- Agent/Tool 文档应帮助自动化 agent 或维护者理解可用命令、搜索策略和工具边界。


## 与 evidence-search.md 的关系

`domain-map.md` 决定“该写到哪里”；`evidence-search.md` 决定“先去哪里找证据”。Planner 可以用 `evidence-search.md` 提高召回率，但不能因此扩大写入范围或绕过路径安全。

## 索引页与正文档

读取 `references/document-granularity.md` 后再决定 target_path。硬规则：

- `index.md`、入口型 `http.md`、入口型 `events.md`、`workspaces.md` 只能做 navigation/index doc，不承载完整正文。
- 表、接口资源组、业务流程、状态机、配置域、runbook、诊断路径、service、package 都是 leaf substantive doc，必须有独立文件并包含 `证据与边界`。
- 如果某领域目前只有 index 文件存在，Planner 必须创建 leaf doc，再更新 index 链接它；不得把完整正文追加进 index。
- 初始化时若某领域暂无证据，不要创建空正文档；在 `ACTIONDOCK.md` 的“待建立 / 暂无证据”中标记即可。

## 大仓库 / workspace 目标路径

当仓库是 monorepo、多服务或多 package 结构时，优先使用这些正式目标：

| 场景 | 目标路径 |
|---|---|
| workspace 总览 | `docs/code/workspaces.md` |
| service 知识页 | `docs/services/<service>.md` |
| package 知识页 | `docs/packages/<package>.md` |
| 跨服务契约 | `docs/api/compatibility.md`, `docs/api/events.md` |
| 迁移/兼容说明 | `docs/domain/migrations.md` |

规则：

- `ACTIONDOCK.md` 只链接这些入口，不展开每个 service 的全部细节。
- service/package 文档是 substantive doc，必须包含证据与边界。
- 不要为没有证据的 service/package 创建空文档；可在 workspace 索引中标记“暂无证据”。

## 推荐 leaf 路径示例

| 实体类型 | 推荐路径 |
|---|---|
| 业务流程 | `docs/domain/flows/<flow-name>.md` |
| 状态机 | `docs/domain/state-machines/<machine-name>.md` |
| HTTP 资源组 | `docs/api/http/<resource>.md` |
| 事件族 | `docs/api/events/<event-family>.md` |
| 核心数据表 | `docs/data/tables/<table>.md` |
| 跨表事务 | `docs/data/transactions/<transaction>.md` |
| 配置域 | `docs/ops/config/<config-domain>.md` |
| 诊断路径 | `docs/diagnosis/<symptom-or-failure>.md` |
| 维护 runbook | `docs/ops/maintenance/<operation>.md` |
| 服务 | `docs/services/<service>.md` |
| package | `docs/packages/<package>.md` |

Index 或入口页只负责链接这些 leaf docs。
