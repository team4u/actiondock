# Examples

这些示例用于检查 skill 行为是否稳定。它们不是运行时必须读取的知识库材料。

每个示例包含：

- `input.md`：用户请求和简化仓库状态。
- `expected-*.json`：关键角色的期望输出形态。
- `expected-report.md`：报告应包含的重点。

覆盖场景：

1. `init-small-node-repo`：小型 Node 仓库初始化，不制造 API/Data 断链。
2. `refresh-migration-change`：迁移和服务变更触发 Data / Business Flow 文档更新。
3. `ingest-runbook-note`：吸收 `.kb_inbox/` runbook，成功后才允许 cleanup。
4. `validate-broken-links`：只读识别 ACTIONDOCK 断链和正文档缺证据区。
5. `xs-env-change`：极小 env 更新，只触发配置文档最小编辑。
6. `m-new-feature`：中等新功能，触发 API/Data/Business Flow 多 domain 更新。
7. `l-api-v2-migration`：大更新，必须包含兼容性说明和分 phase。
8. `xl-monorepo-refresh`：超大仓库，先识别 workspace 并降噪。
9. `rename-move`：模块路径迁移，优先迁移已有文档。
10. `stale-doc-refresh`：长期过期文档，允许保留人工内容后整体重写。
