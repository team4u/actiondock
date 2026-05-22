# 工作流

正式产物路径和 run 记录以 `knowledge-contract.json` 为准。

## 1. submit

- 调用 `init`、`refresh` 或 `ingest`。
- 调用方通过 `runner` 决定 internal Agent 或 external CLI Agent。
- 插件立即返回 `ACCEPTED` 和 `runId`。
- 后续通过 `getRun` 查询异步结果。

## 2. inspect

- 插件读取 Git 变更路径、`.knowledge_base/` 目录树和 `.kb_inbox/`。
- 插件不维护代码到文档的外部元数据索引。

## 3. chief-plan

- 插件创建 Chief Architect Agent。
- Chief 只根据路径和目录树输出 phase 编排。
- Chief 不读具体代码，不输出 Markdown 任务。

## 4. domain-plan

- 每个 phase 内，插件创建对应 Domain Planner Agent。
- Planner 使用 shell 勘测本领域代码和知识库目录。
- Planner 只输出 `UPSERT` / `PRUNE` 任务清单，不写文件。

## 5. worker-reconcile

- 插件按 `target_path` 去重和校验路径安全。
- 插件并发创建 Specialized Worker Agent。
- 每个 Worker 只负责一个目标 Markdown 文件。
- Worker 失败最多重试 3 次；仍失败时写入 `.knowledge_base/07_Maintenance_and_Ops/ERRORS.md`。

## 6. finalize-entry

- 插件串行维护缺失的 `ACTIONDOCK.md` 和 `.knowledge_base/SUMMARY.md`。
- `ACTIONDOCK.md` 只做入口导航，不承载深度正文。

## 7. validate / record-run

- 插件校验正式知识库。
- 校验失败时 run result 为 `NEEDS_REVIEW`，文件不自动回滚。
- 插件只写入 `.actiondock/project-knowledge/runs/<runId>.json` 作为编排运行记录。
