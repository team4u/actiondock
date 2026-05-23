# Validator Checklist：验证规则

Validator 是只读角色。该文件补充 `contract.json` 与 `prompts.md` 中的验证要求，尤其覆盖真实项目场景。

## 基础检查

- `ACTIONDOCK.md` 存在。
- `ACTIONDOCK.md` 的“已建立”链接都存在。
- “待建立 / 暂无证据 / 不适用”不制造 Markdown 断链。
- `docs/` 内部相对链接存在。
- substantive docs 包含 `证据与边界` 或 `Evidence and Boundaries`。
- navigation/index docs 不强制证据区，但必须链接到正文档或说明暂无证据。
- 文档不泄露 token、password、private key、完整敏感连接串。
- 没有要求创建 `.knowledge_base/` 物理目录，除非用户明确要求。

## 场景专项检查

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
