# 分析域

只回答三件事：是否激活、生成什么、优先做什么。不要在这里重复批处理常量，也不要假定存在 validator 或固定的外部证据序列化结构。

| 分析域 | 激活条件 | 主要证据 | 典型输出 |
|---|---|---|---|
| 代码结构 | 仓库存在多目录、模块或明确入口点 | `package.json`、`pom.xml`、`go.mod`、入口文件、README | `docs/code/index.md`、`docs/code/modules.md` |
| 架构 | 存在分层代码、组件边界或跨模块调用 | Controller、Router、Service、Repository、Client、Job、Consumer | `docs/code/architecture.md`、`docs/code/symbols.md` |
| 业务流程 | 存在端到端业务用例或状态/数据变化链路 | Controller、Router、Service/UseCase、Job、Consumer、Webhook、状态变化、关键表写入 | `docs/domain/flows/index.md`、`docs/domain/flows/*.md` |
| 业务规则 | 存在业务校验、约束或不变量 | Validator、条件分支、异常抛出、唯一约束、权限判断、测试断言 | `docs/domain/rules.md` |
| 状态机 | 存在核心对象状态枚举和迁移逻辑 | Enum、常量、状态字段、转换分支、补偿逻辑、测试 | `docs/domain/state-machines/*.md` |
| 数据模型 | 存在数据库模型或持久化定义 | DDL、ORM 实体、Repository、Mapper、SQL、迁移后的当前表结构 | `docs/data/index.md`、`docs/data/schema.md`、`docs/data/tables/*.md` |
| 数据行为 | 存在事务、一致性或缓存逻辑 | `@Transactional`、锁、唯一约束、补偿任务、Redis、缓存注解 | `docs/data/transactions.md`、`docs/data/consistency.md`、`docs/data/cache.md` |
| API 与事件 | 存在 HTTP、MQ、Webhook 或 OpenAPI | Controller、Router、Swagger/OpenAPI、Producer、Consumer、Event 类 | `docs/api/http.md`、`docs/api/events.md` |
| 外部依赖 | 存在第三方或内部服务调用契约 | Client、SDK、Feign、HTTP 调用、MQ topic、Webhook 配置 | `docs/integrations/index.md`、`docs/integrations/*.md` |
| 诊断 | 存在日志、异常、错误码、告警线索、常用 SQL、日志查询或问题级排查片段 | logger 调用、异常类、错误码枚举、MDC、告警样例、`evidenceFiles` 提供的诊断线索 | `docs/diagnosis/index.md`、`docs/diagnosis/logs.md`、`docs/diagnosis/exceptions.md`、`docs/diagnosis/runbook.md`、`docs/diagnosis/sql-playbook.md`、`docs/diagnosis/log-playbook.md` |
| 观测与告警 | 存在指标、trace、告警、dashboard 或观测配置 | Micrometer/Prometheus、traceId、MDC、报警配置、日志样例 | `docs/diagnosis/observability.md`、`docs/diagnosis/alerts/index.md` |
| 配置与运维 | 存在运行配置或部署依赖 | `application.yml`、`.env`、Dockerfile、compose、Helm、CI | `docs/ops/dependencies.md`、`docs/ops/config/index.md` |
| 任务与补偿 | 存在定时任务、异步处理、重试或补偿 | Job、Scheduler、Consumer、Retry、Compensation、Backfill | `docs/ops/jobs.md`、`docs/ops/compensation.md` |
| 运维操作 | 存在管理接口、修复脚本、手动重试或危险写操作 | Admin Controller、脚本、修复任务、管理后台操作 | `docs/ops/manual-operations.md` |
| 开发与测试 | 仓库含本地运行或测试入口 | README、Makefile、npm scripts、Gradle/Maven task、测试目录、CI | `docs/dev/local-dev.md`、`docs/dev/test.md` |
| 安全 | 存在认证、授权或敏感操作边界 | 权限注解、中间件、敏感接口、Token/API key 处理 | `docs/security/permissions.md`、`docs/security/sensitive-operations.md`、`docs/agent/shell-policy.md` |
| Agent 指南 | 已经产出足够的诊断、代码、数据或安全事实，或发现查询工具上下文证据 | 上述域的最终文档与源码证据、仓库配置、`evidenceFiles` 提供的工具上下文和仓库事实 | `docs/agent/alert-diagnosis.md`、`docs/agent/code-search.md`、`docs/agent/knowledge-update.md`、`docs/agent/tool-context.md` |

## 域到模板的映射

- `template-actiondock.md`：入口导航
- `template-common.md`：代码结构、架构、开发与测试、通用主题
- `template-flows.md`：流程索引、流程正文、业务规则、状态机
- `template-data.md`：数据模型索引和数据表文档
- `template-integrations.md`：外部依赖
- `template-ops.md`：任务、补偿、运维操作
- `template-diagnosis.md`：观测、诊断索引、runbook、SQL/日志手册
- `template-security.md`：认证、授权、敏感操作、安全边界
- `template-agent.md`：Agent 指南和查询工具上下文

## 激活和优先级启发式

- 只激活有证据的域；证据极弱时写入报告，不生成看似完整的正文。
- 流程域优先级高于零散接口摘要。只要能追到端到端业务目标、状态变化或关键表写入，就先建候选流程清单。
- 数据域优先级高于结构摘录。只要存在完整 DDL、ORM 或持久化 SQL，就先建立完整表清单，再决定正文节奏。
- 诊断域优先级高于日志罗列。只有能形成“场景 -> 查询/判断 -> 下一步”的证据时，才写 playbook 或 runbook。
- `schema_evidence`、`diagnosis_fragments`、`tool_context`、`repo_facts`、`generation_prefs`、`unknown_notes` 这些词只作为思考和写作提示，用来帮助判断证据更适合服务哪个主题；不要求把每份材料固定落桶或固定序列化。
- Agent 指南必须依赖已经落地的项目事实；`shell-policy.md` 只能来自安全分析结果，不能用通用模板顶替。
- 首批优先生成对新人理解、SQL 编写和故障排查价值最高的项：入口清晰、状态变化明确、关键表写入、外部依赖明显、排障价值高。
- 跳过项只允许因为重复、证据不足、解析冲突或用户显式排除；原因必须回写到索引和报告。
