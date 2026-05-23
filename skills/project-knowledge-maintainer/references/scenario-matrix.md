# Scenario Matrix：真实项目场景策略

本文件帮助 Router 判断 scale、flow profile、change types、workspace scope 和专项检查。

## 1. Scale 与 flow profile

| Scale | 典型场景 | flow_profile | 规划深度 |
|---|---|---|---|
| `XS` | 单个 env、命令、链接、注释级事实、小配置名 | `lite` | 不强制 Planner / document_set_plan |
| `S` | 少量相关文件、一个已知 leaf doc 可覆盖 | `lite` | 可用轻量 task list |
| `M` | 新 endpoint、新表、小型功能、多 domain 但范围明确 | `standard` | task plan；有拆分风险时 document_set_plan |
| `L` | breaking change、迁移、大功能、多模块重构 | `structured` | 强制 document_set_plan + phase |
| `XL` | monorepo、多服务、大量 changedFiles、噪音重 | `partitioned` | workspace scope + noise filter + 分区 document_set_plan |

## 2. 小更新策略：XS/S

目标：让 Codex 等 coding agent 直接完成低风险维护，不被重流程拖慢。

适用信号：

- 变更集中在 1-3 个文件。
- 只影响一个已有 leaf doc。
- 没有新业务实体、API resource、表、runbook、service 或 package。
- 没有 breaking、rename、stale、monorepo 扩散风险。

流程：

1. Route-lite。
2. 直接更新目标 leaf doc 或入口链接。
3. Validate-lite。
4. Report 写清楚 scope 是轻量验证。

不得做：

- 为了流程完整性而列出七个 skipped domain。
- 为了小改动强制生成 document_set_plan。
- 把正文写入 index。

## 3. 中等更新策略：M

适用信号：

- 新增 API endpoint/resource。
- 新增或修改数据库表 / migration。
- 新增业务流程。
- 新配置域影响运行行为。
- 一个 feature 横跨 2-3 个 domain。

流程：

1. Route。
2. 判断是否需要 document_set_plan。
3. Task Plan。
4. Apply。
5. Validate。

M 必须启用 document_set_plan 的情况：

- 新 leaf doc 预计出现。
- 目标 index 可能承载正文。
- 多个实体需要拆分。
- ingest 内容需要分流。

## 4. 大更新策略：L

适用信号：

- breaking change。
- API v2 / schema migration。
- 业务状态流重构。
- 多模块重构。
- 旧文档 materially stale。

流程：

1. Route。
2. 分 phase。
3. Document Set Plan。
4. Task Plan。
5. Phased Apply。
6. Full Validate。

phase 原则：

- 先 Data / Infra / workspace boundary。
- 再 API / Business Flow / Agent Tool。
- 最后 Architecture / ACTIONDOCK / navigation。

API-only 大更新可以跳过无关 Data/Infra phase，但 Architecture/ACTIONDOCK 仍最后汇总。

## 5. 超大仓库策略：XL

适用信号：

- monorepo。
- 大量 changedFiles。
- 多 service / package。
- generated 或 lockfile 噪音重。
- 一个共享包可能影响多个 downstream。

流程：

1. 识别 workspace / service / package scope。
2. 降噪。
3. 只刷新受影响 partition。
4. 每个 partition 做 document_set_plan。
5. 最后更新 workspace index 和 ACTIONDOCK。

规则：

- 不把局部 service 事实写成全仓库事实。
- 共享包变化要判断 downstream；证据不足时写 evidence gap。
- `ACTIONDOCK.md` 只链接入口，不展开所有 service 细节。

## 6. change types

| change_type | 触发信号 | 常见 domain |
|---|---|---|
| `api` | router/controller/schema/protobuf/GraphQL 变化 | API, Business Flow |
| `schema` | migration/DDL/ORM/entity/SQL 变化 | Data, Business Flow, API |
| `business_rule` | service/use-case/state machine/job/listener 变化 | Business Flow, API, Data |
| `infra` | Docker/K8s/CI/env/config/deploy 变化 | Infra/Env, Maintenance/Ops |
| `dependency` | package manager、lockfile、runtime dependency 变化 | Infra/Env, Agent/Tool |
| `test_workflow` | test scripts、CI test matrix、fixtures 变化 | Agent/Tool, Infra/Env |
| `ops_runbook` | runbook、logs、monitoring、manual ops 变化 | Maintenance/Ops |
| `rename_move` | path rename、module move、package rename | affected domain + Architecture |
| `delete_deprecate` | feature/file/API/table deletion | affected domain + compatibility |
| `breaking_change` | contract 破坏、字段删除、权限语义改变 | API, Data, Business Flow |
| `stale_docs` | docs 与代码大面积冲突 | affected domain |
| `monorepo_workspace` | workspace/service/package 边界变化 | Architecture, affected domain |
| `config` | env/config default/validation 变化 | Infra/Env |
| `agent_tool` | script/CLI/tooling 变化 | Agent/Tool |

## 7. 降噪规则

大量 changedFiles 时先分类：

| classification | 示例 | 默认处理 |
|---|---|---|
| `generated_or_format_only` | generated client、formatter-only diff | 不触发业务文档，除非有语义证据 |
| `build_output` | dist/build/target | 跳过 |
| `dependency_output` | vendor/node_modules | 跳过 |
| `format_only` | whitespace/prettier only | 跳过或低优先级 |
| `lockfile_only_auxiliary` | 仅 lockfile 且 manifest 无变化 | 记录，不单独触发正文 |
| `outside_scope` | 用户范围外 | 跳过并说明 |
| `test_snapshot_noise` | 大量 snapshot | 只在测试契约变化时处理 |
| `vendor_or_third_party` | third_party/vendor | 跳过 |
| `semantic_auxiliary` | 支持性文件，有语义但非主证据 | 作为辅助证据 |

## 8. rename / move

检测到 rename/move 时：

- 优先迁移或更新已有相关文档。
- 输出 old_path → new_path 映射到 report。
- 若旧文档只描述已迁移实体，可改名或 UPSERT 后 PRUNE。
- 若是综合页，则更新相关章节。
- 旧文档只有确认无引用、无有效内容、无人工 TODO 后才允许 PRUNE。
- Validator 检查新旧重复文档。

## 9. breaking change

以下情况标记 `breaking_change` 或 `possibly_breaking_change`：

- API 删除字段、重命名字段、改变必填性、改变返回结构。
- 鉴权/权限规则改变。
- 状态枚举或状态流改变。
- 数据库字段语义改变、单位改变、精度改变。
- 事件 topic、payload、routing key、consumer contract 改变。
- 删除 CLI 参数、环境变量或运维命令。

文档必须说明：

- 旧行为。
- 新行为。
- 影响对象。
- 迁移边界。

## 10. stale docs

默认最小编辑。只有 materially stale 时允许 `full_rewrite_with_preservation`。

判断信号：

- 文档核心事实超过约 40% 与当前代码冲突。
- 文档描述的主要模块、路由、表或命令已经不存在。
- 文档结构阻碍维护，局部修补会制造更多矛盾。

整体重写必须保留：

- 人工 TODO、备注、历史背景、未解决问题。
- 仍有效的外部链接和运维注意事项。
- 旧文档中与当前代码不冲突的事实。
