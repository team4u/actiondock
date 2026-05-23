# Validator Checklist：验证规则

Validator 是只读角色。该文件补充 `contract.json` 与 `prompts.md` 中的验证要求，尤其覆盖真实项目场景。

## 基础检查

- `ACTIONDOCK.md` 存在。
- `ACTIONDOCK.md` 的“已建立”链接都存在。
- “待建立 / 暂无证据 / 不适用”不制造 Markdown 断链。
- `docs/` 内部相对链接存在。
- substantive docs 包含 `证据与边界` 或 `Evidence and Boundaries`。
- navigation/index docs 不强制证据区，但必须链接到正文档或说明暂无证据。
- navigation/index docs 不得成为正文事实容器。
- 文档不泄露 token、password、private key、完整敏感连接串。
- 没有要求创建 `.knowledge_base/` 物理目录，除非用户明确要求。

## 场景专项检查


### 文档颗粒度 / index_content_sink

Validator 必须检查 index 和入口页是否只做导航。

触发 `index_content_sink`：

- `index.md` 里出现多个具体业务流程、API 资源、数据表、配置域、runbook 或诊断正文。
- `docs/api/http.md` 或 `docs/api/events.md` 承载完整资源/事件详情，而不是链接到 leaf docs。
- `docs/data/index.md` 承载完整字段目录。
- `docs/domain/flows/index.md` 承载完整流程步骤或多个 Mermaid 流程图。
- `docs/ops/config/index.md` 承载多个配置域的详细 env 表。
- `docs/diagnosis/index.md` 承载具体排障步骤。

严重度：

- `warning`：index 有少量正文，但还不是主要事实来源。
- `error`：index 已替代 leaf docs，承载多个长期事实实体。

建议修复：拆分为 leaf docs，并让 index 只保留链接、短说明和状态标记。



### 子文档清单规划 / document_set_plan

Validator 必须检查 Planner 是否先完成子文档清单规划。

触发 `document_set_plan_missing`：

- 激活 domain 有写入任务，但 Planner output 没有 `document_set_plan`。
- `document_set_plan` 没有覆盖对应 category，例如 API 任务没有 `api_http_resources`，流程任务没有 `business_flows`。

触发 `missing_required_leaf_doc`：

- `document_set_plan.leaf_docs[]` 中 `priority=must` 且 `status=create|update|deprecate`，但没有对应 task、结果文件或失败记录。
- `priority=must` 且 `status=defer`，但没有 `defer_reason`。

触发 `index_without_leaf_docs`：

- index/navigation doc 列出具体流程、资源、配置、服务或诊断项，但没有对应 leaf doc。
- index 链接缺失，或只保留文字清单而不链接已创建 leaf doc。

触发 `category_under_split`：

- 多个独立业务流程挤在一个 flow 文档。
- 多个 API resource 挤在 `docs/api/http.md` 或单个 resource 文档中。
- 多个配置域挤在一个 config 文档中。
- 多个诊断路径或 runbook 挤在一个文档中。
- monorepo 中多个 service/package 的细节挤在 `docs/code/workspaces.md`。

触发 `unplanned_leaf_doc`：

- Worker 创建或修改的 leaf doc 不在 Planner `document_set_plan` 中，也不是明确的 repair 任务。

建议修复：让 Planner 重新输出完整 `document_set_plan`，再由 Worker 按清单创建/更新 leaf docs 和对应 index 链接。

### 大仓库 / monorepo

- `workspace_scope` 非空时，检查是否存在 `docs/code/workspaces.md` 或等价 workspace/service 索引。
- `ACTIONDOCK.md` 不应堆积所有 service 细节，只链接入口文档。
- 不应把一个 package/service 的事实写成全仓库事实。

### rename / move

- 检查是否有新旧重复文档同时声称是当前事实。
- 检查 old_path → new_path 是否出现在 report 或维护备注中。
- 检查旧文档 PRUNE 前是否无有效链接引用。

### breaking change

- 检查 breaking 或 possibly breaking 变更是否有兼容性说明。
- 影响 API/Data/Event/CLI/Env 的破坏性变更，必须说明影响对象和迁移边界。

### stale docs

- 如果使用整体重写，report 必须说明 `edit_mode` 和保留内容。
- 如果检测到旧文档大面积过时但未处理，应给出 warning 或 FAIL，取决于断链/错误事实严重性。

### changedFiles 降噪

- `noise_filters[].classification` 必须来自 contract 中的 `noiseFilterClassificationValues`。
- XL / noise-heavy 场景必须说明哪些文件被跳过、哪些仍作为辅助证据。

- XL 或大量 changedFiles 场景下，report 必须列出 noise/skipped 类别。
- 不能因为 generated 或 format-only 变更生成业务事实文档。

## 状态判断

- `PASS`：无 findings。
- `PASS_WITH_WARNINGS`：有非阻塞缺口或待确认项。
- `FAIL`：断链、路径越界、secret 暴露、明显错误事实、未处理的重大 breaking/stale 风险。
