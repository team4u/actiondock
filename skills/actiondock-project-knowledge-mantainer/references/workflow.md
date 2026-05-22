# 工作流

按这个顺序执行，除非用户明确只要求其中一部分。正式产物路径、状态文件和 staging 目录统一以 `knowledge-contract.json` 为准。

## 1. scan

- 代码扫描仓库，收集构建文件、README、配置、Controller/Router、Job/Consumer、DDL/ORM、Client、安全相关入口。
- 产出结构化证据目录；每条证据都必须带路径和摘要片段。
- 如果用户提供 `evidenceFiles`，只把它们当作补充证据，不当作代码事实替代品。

## 2. generate

- AI 基于证据目录生成紧凑的知识文档集合。
- AI 只能引用已有 evidence，不能发明路径、模块、流程或表。

## 3. stage-validate

- 文档先写入 staging。
- staging 校验失败时返回 `NEEDS_REVIEW`，不发布正式正文。

## 4. publish

- 正式 Markdown 由代码写入。
- `ACTIONDOCK.md` 只做导航。
- 报告记录生成文件和待审项。
- 写入 `state.json` 并清理本插件上一次生成但本次不再需要的正式文件。
