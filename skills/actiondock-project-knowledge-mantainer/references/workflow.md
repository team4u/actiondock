# 工作流

按这个顺序执行，除非用户明确只要求其中一部分。正式产物路径和 run 记录以 `knowledge-contract.json` 为准。

## 1. submit

- 调用 `init`、`refresh` 或 `ingest`。
- 插件立即返回 `ACCEPTED` 和 `runId`。
- 后续通过 `getRun` 查询异步结果。

## 2. agent-maintain

- Agent 直接读取代码、现有知识库和输入资料。
- Agent 自行决定需要新增、更新或删除哪些知识正文。
- Agent 直接维护 `ACTIONDOCK.md` 和 `.knowledge_base/`。

## 3. validate

- 插件对正式知识库执行质量校验。
- 校验失败时 run result 为 `NEEDS_REVIEW`，文件不自动回滚。

## 4. record-run

- 插件只写入 `.actiondock/project-knowledge/runs/<runId>.json`。
- 不维护 staging、state.json、fingerprint 或报告文件。
