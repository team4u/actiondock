# Scenario Matrix：真实项目变更场景矩阵

该文件用于让 Router 在进入 domain 路由前，先判断真实项目变更的规模、类型和特殊风险。它不替代 `domain-map.md`；它决定“用什么策略处理”，`domain-map.md` 决定“写到哪里”。

## 1. 变更规模分级

| Scale | 名称 | 典型信号 | 默认策略 |
|---|---|---|---|
| `XS` | 极小更新 | 1-3 个文件；单字段、单 env、单错误码、单命令 | 单 target 最小编辑 |
| `S` | 小更新 | 单接口、单配置、单脚本、单表字段、单 runbook | 单 domain 或少量 target 最小编辑 |
| `M` | 中等更新 | 新功能同时影响 API/Data/Flow；2-4 个 domain | 多 domain refresh，合并同 target 任务 |
| `L` | 大更新 | 模块重构、数据库大迁移、API v2、鉴权体系变化 | 分 phase：底层事实 → 业务/接口 → 架构/入口 |
| `XL` | 超大更新 / 大仓库 | monorepo、多服务、上百/上千 changed files、大规模 rename | 先分区、降噪、分批维护；禁止无边界全仓库重写 |

Scale 是执行策略提示，不是质量等级。小变更也必须有证据，大变更也必须尽量最小编辑。

## 2. 变更类型

Router 应从 changedFiles、Git diff 摘要、用户请求和仓库结构中识别以下 `change_type`。一个运行可以有多个类型。

| change_type | 典型证据 | 常见 domain |
|---|---|---|
| `api_change` | route/controller/DTO/OpenAPI/GraphQL/protobuf 变化 | API、Business Flow |
| `schema_change` | migration、DDL、ORM entity、schema.prisma、model 变化 | Data、Business Flow |
| `business_rule_change` | service/usecase/state machine/job/listener 流程变化 | Business Flow、Architecture |
| `infra_change` | Docker、compose、k8s、helm、CI、env、config 变化 | Infra/Env、Ops |
| `dependency_change` | package manifest、lockfile、go.mod、Gemfile 等 | Infra/Env、Dev/Test |
| `test_workflow_change` | test config、scripts、fixtures、CI test job 变化 | Infra/Env、Agent/Tool |
| `ops_runbook_change` | runbook、incident、diagnosis、manual operation | Maintenance/Ops |
| `rename_move` | Git rename/move、路径整体迁移、模块名替换 | Architecture、相关 domain |
| `delete_deprecate` | 文件/接口/字段/模块删除或 deprecated 标记 | 相关 domain、Compatibility |
| `generated_or_format_only` | 只改 generated/build/format 输出，无语义变化 | 通常跳过 |
| `breaking_change` | 删除/重命名契约、鉴权改变、状态枚举/事件 payload 变化 | API、Data、Business Flow、Ops |
| `stale_doc_refresh` | 现有 docs 与当前代码大面积冲突 | 相关 domain、ACTIONDOCK |
| `monorepo_workspace_change` | apps/packages/services/libs/infra 分区变化 | Architecture、受影响 service/package |

## 3. changedFiles 降噪规则

Router 在路由前先做降噪。Planner 仍可读取被降噪文件作为辅助证据，但不要让噪音决定正式任务。

`noise_filters[].classification` 使用以下枚举：

- `generated_or_format_only`：生成代码或纯格式化输出。
- `build_output`：构建产物，例如 `dist/`、`build/`、`target/`。
- `dependency_output`：依赖目录或供应商代码，例如 `node_modules/`、`vendor/`。
- `format_only`：仅 whitespace、import sort、lint fix。
- `lockfile_only_auxiliary`：lockfile 只能作为依赖辅助证据。
- `outside_scope`：不属于本次 workspace / user scope 的变更。
- `test_snapshot_noise`：snapshot 或金丝雀输出变更，缺少语义证据。
- `vendor_or_third_party`：第三方复制代码或 vendor 目录。
- `semantic_auxiliary`：可读作辅助证据，但不足以单独触发正式文档任务。

默认降权或跳过：

- generated 文件：`generated/`、`__generated__/`、OpenAPI generated client、Prisma generated client。
- build 输出：`dist/`、`build/`、`target/`、`.next/`、`coverage/`。
- dependency 目录：`node_modules/`、`vendor/`。
- 纯格式化变更：只有 whitespace、import sort、lint fix，且无语义证据。
- lockfile-only 变更：只有 lockfile 时，通常更新依赖说明；不要推导业务变化。

强证据文件即使很少也要保留：

- manifest：`package.json`、`pyproject.toml`、`go.mod`、`Gemfile`、`pom.xml`、`Cargo.toml`。
- schema/migration：`migrations/`、`schema.prisma`、DDL、ORM entity。
- API 契约：router/controller/DTO/OpenAPI/protobuf/GraphQL schema。
- 部署与环境：Docker、compose、k8s、helm、CI、`.env.example`。


## 3A. 文档颗粒度策略

场景分类之后，Planner 必须应用 `references/document-granularity.md`：

- `index.md` 只能做导航和状态总览。
- 主业务流程、API 资源组、事件族、数据表、跨表事务、配置域、runbook、诊断路径、service/package 必须拆成 leaf docs。
- 如果本次变更是 XS/S，但触及一个新的具体实体，也应创建 leaf doc，而不是追加到 index。
- 如果本次变更是 M/L/XL，且涉及多个具体实体，必须按实体拆分多个 leaf docs，避免形成新的大杂烩。
- Validator 应把 index 正文堆积识别为 `index_content_sink`。

## 4. 大仓库 / monorepo 策略

当仓库包含 `apps/`、`packages/`、`services/`、`libs/`、`infra/`、`terraform/`、`charts/`，或 changedFiles 跨多个独立服务时，Router 必须输出 `workspace_scope`。

处理顺序：

1. 识别 workspace / service / package 边界。
2. 判断 changedFiles 属于哪个分区。
3. 只刷新受影响分区和共享依赖的知识文档。
4. `ACTIONDOCK.md` 只做总入口，不堆积每个服务细节。
5. 对每个 service/package 优先使用局部文档，例如：
   - `docs/services/<service>.md`
   - `docs/packages/<package>.md`
   - `docs/code/workspaces.md`

禁止：

- 因为是大仓库就重写全部 docs。
- 在没有证据的情况下为所有 service 生成空文档。
- 把一个 service 的事实推广到所有 service。

## 5. L / XL 分阶段策略

大更新应按 phase 执行；若变更只涉及 API 契约，可跳过无关的 Data/Infra phase，但 Architecture / ACTIONDOCK 仍必须最后汇总：

1. **Phase 0：范围与底层事实**  
   若涉及 Data / Infra / workspace boundary，先确认；API-only 变更可跳过。
2. **Phase 1：业务与契约**  
   API / Business Flow / Events / Tool 文档更新。
3. **Phase 2：架构与入口**  
   Architecture / ACTIONDOCK / report 最后汇总。
4. **Phase 3：专项验证**  
   检查 breaking、rename 重复文档、stale docs、service coverage。

## 6. rename / move 策略

检测到 `rename_move` 时：

- 优先迁移或更新已有相关文档，不要直接创建重复新文档。
- 输出 old_path → new_path 映射到 report。
- 若旧文档只描述已迁移实体，可改名或 UPSERT 后 PRUNE；若是综合页，则更新相关章节。
- 旧文档只有确认无引用、无有效内容、无人工 TODO 后才允许 PRUNE。
- Validator 必须检查是否出现新旧重复文档。

## 7. breaking change 策略

以下情况必须标记 `breaking_change` 或 `possibly_breaking_change`：

- API 删除字段、重命名字段、改变必填性、改变返回结构。
- 鉴权/权限规则改变。
- 状态枚举或状态流改变。
- 数据库字段语义改变、单位改变、精度改变。
- 事件 topic、payload、routing key、consumer contract 改变。
- 删除 CLI 参数、环境变量或运维命令。

建议目标文档：

- `docs/api/compatibility.md`
- `docs/domain/migrations.md`
- 相关 API/Data/Flow 正文档的兼容性章节

Worker 应记录：

- 影响对象：clients、workers、consumers、operators、migrations。
- 迁移说明：旧行为、新行为、注意事项。
- 证据路径与不确定边界。

## 8. stale docs 策略

默认仍是最小编辑。但如果旧文档与当前代码大面积冲突，允许 `full_rewrite_with_preservation`。

判断信号：

- 文档核心事实超过约 40% 与当前代码冲突。
- 文档描述的主要模块、路由、表或命令已经不存在。
- 文档结构阻碍维护，局部修补会制造更多矛盾。

整体重写时必须保留：

- 人工 TODO、备注、历史背景、未解决问题。
- 仍有效的外部链接和运维注意事项。
- 旧文档中与当前代码不冲突的事实。

Report 必须写明：

- `edit_mode: full_rewrite_with_preservation`
- 为什么不是最小编辑。
- 保留了哪些人工内容，移除了哪些 stale 内容。

## 9. 删除 / deprecated 策略

对于 `delete_deprecate`：

- 删除代码不等于立刻删除文档。
- 如果功能仍在线上、仍有兼容窗口或仍有历史操作价值，应改为 deprecated 说明。
- 如果正式文档只描述已删除且无保留价值的实体，可 PRUNE。
- PRUNE 前必须检查 ACTIONDOCK 和 docs 内部链接。

## 10. Validator 专项检查

Validator 除基础检查外，还要检查：

- 大仓库是否有 workspace/service 索引或清楚标记不适用。
- index/入口页是否只做导航，没有承载 leaf doc 应承载的正文。
- breaking change 是否有兼容性说明。
- rename 后是否产生重复文档。
- stale 文档是否被修复、标记或合理保留。
- `ACTIONDOCK.md` 是否只作为入口，没有堆积 service 细节。
- XL 场景是否报告降噪规则、workspace_scope 和 skipped noise。
