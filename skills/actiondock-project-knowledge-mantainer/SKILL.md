---
name: actiondock-project-knowledge-mantainer
description: 通过 ActionDock 项目知识库插件生成并校验本地代码仓库的项目知识库。
---

# 项目知识库维护器

## 目标

当用户要求生成或校验项目知识库时，不要手工按模板写文档。应调用平台插件 `actiondock-project-knowledge`，由插件负责：

- 代码主导的结构扫描
- AI 辅助的知识文档生成
- staging 校验
- 正式文档写入与状态持久化

Skill 只负责判断何时调用插件、准备输入、解释返回结果。

## 标准调用

必需输入：

- `repoPath`：目标仓库根目录

常用可选输入：

- `evidenceFiles`：补充证据文件
- `audience`：默认 `balanced`
- `detailLevel`：默认 `standard`
- `aiProfile`
- `aiProfiles.writer`

生成知识库：

```bash
actiondock plugin invoke actiondock-project-knowledge generate \
  --input-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer"}' \
  --json
```

单独校验：

```bash
actiondock plugin invoke actiondock-project-knowledge validate \
  --input-json '{"repoPath":"/path/to/repo"}' \
  --json
```

## 结果解释

- `status=SUCCESS`：正式文档已写入且质量门通过。
- `status=NEEDS_REVIEW`：生成已完成，但 staging 质量门未通过；不会发布正式正文。

## 边界

- 不自动 stage、commit、push 或创建 PR。
- 不绕过插件直接维护 `ACTIONDOCK.md`、报告或插件拥有的生成目录。
- 不把 `.actiondock/project-knowledge/staging/*` 中间产物当作长期事实来源。
- 对证据不足项，必须保留为报告或审查项，不伪装成正式知识。
