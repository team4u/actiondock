# Examples

这些示例用于检查 skill 行为是否稳定。它们不是运行时必须读取的知识库材料。

每个示例包含：

- `input.md`：用户请求和简化仓库状态。
- `expected-*.json`：关键角色的期望输出形态。
- `expected-report.md`：报告应包含的重点。

## v4.4 自适应流程说明

v4.4 起，示例按 flow profile 分层：

- `lite`：XS/S 小改动。允许没有 `document_set_plan`，但仍需遵守路径安全、secret 保护、证据优先和 validate-lite。
- `standard`：M 更新。默认有 task plan；存在 leaf doc、index 或多实体拆分风险时使用 `document_set_plan`。
- `structured`：L 更新。必须包含 `document_set_plan`、phase 和 full validate。
- `partitioned`：XL / monorepo。必须包含 workspace scope、noise filter、分区规划和 full validate。

## 覆盖场景

1. `init-small-node-repo`：小型 Node 仓库初始化，不制造 API/Data 断链。
2. `refresh-migration-change`：迁移和服务变更触发 Data / Business Flow 文档更新。
3. `ingest-runbook-note`：吸收 `.kb_inbox/` runbook，成功后才允许 cleanup。
4. `validate-broken-links`：只读识别 ACTIONDOCK 断链和正文档缺证据区。
5. `xs-env-change`：极小 env 更新，走 `lite`，只触发配置文档最小编辑。
6. `m-new-feature`：中等新功能，触发 API/Data/Business Flow 多 domain 更新；存在新 leaf doc 时使用 `document_set_plan`。
7. `l-api-v2-migration`：大更新，必须包含兼容性说明、分 phase 和 `document_set_plan`。
8. `xl-monorepo-refresh`：超大仓库，先识别 workspace 并降噪，走 `partitioned`。
9. `rename-move`：模块路径迁移，优先迁移已有文档。
10. `stale-doc-refresh`：长期过期文档，允许保留人工内容后整体重写。
11. `granularity-flow-split`：已有 `docs/domain/flows/index.md` 时，新业务流程必须拆成 leaf doc。
12. `granularity-api-split`：HTTP API 资源组详情不能堆进 `docs/api/http.md`。
13. `granularity-config-split`：配置域详情不能堆进 `docs/ops/config/index.md`。
14. `granularity-index-violation`：Validator 应识别 index 被当作正文容器的违规。
15. `document-set-plan-flows/`：Planner 先规划业务流程子文档清单，再创建 flow leaf docs 和 index 链接任务。
16. `document-set-plan-api/`：Planner 先规划 API resource 子文档清单，再创建 resource leaf docs。
17. `document-set-plan-data/`：Planner 先规划核心表和跨表事务子文档。
18. `document-set-plan-monorepo/`：Planner 先规划 service/package 子文档清单。
19. `document-set-plan-under-split/`：Validator 检查分类拆分不足和缺失 leaf docs。
20. `team-agent-delegate-dispatch/`：team_agent 可用时，每个 target_path 必须有 Worker delegate dispatch。

旧示例中仍出现 `document_set_plan` 的场景通常代表 M/L/XL 或 granularity 风险；XS/S 示例不应再把 `document_set_plan` 当成固定要求。


## v4.4.1 Plan A anti-underplanning

- `planner-underplanning/`：Validator 应识别 Planner 只列一两个文件并把剩余发现交给 Worker 的问题，报告 `planner_underplanning` 和 `delegated_discovery_to_worker`。
- `worker-subagent-dispatch/`：兼容旧名；Validator 应识别 native_subagent 模式下 Leader 绕过 Worker subagent 批量写正文档的问题，报告 `worker_delegate_not_dispatched` 或兼容别名 `worker_subagent_not_dispatched`。
- `team-agent-delegate-dispatch/`：Validator 应识别 team_agent 可用时 Leader 绕过 Worker delegate 批量写正文档的问题，报告 `worker_delegate_not_dispatched`。
