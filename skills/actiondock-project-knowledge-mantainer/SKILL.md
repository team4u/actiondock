---
name: actiondock-project-knowledge-mantainer
description: 通过 ActionDock 项目知识库插件生成并校验本地代码仓库的项目知识库。
---

# 项目知识库维护器

## 目标

当用户要求生成或校验项目知识库时，不要手工按模板写文档。应调用平台插件 `actiondock-project-knowledge`，由插件负责：

- 异步编排知识库维护任务
- 调用 Agent 直接维护正式知识库正文
- 执行最终质量校验
- 持久化 run 状态

Skill 只负责判断何时调用插件、准备输入、解释返回结果。

## 标准调用

必需输入：

- `repoPath`：目标仓库根目录

常用可选输入：

- `aiProfile`
- `runner`
- `changedFiles`：refresh 时提供变更文件
- `sources`：ingest 时提供手工资料路径

初始化知识库：

```bash
actiondock plugin invoke actiondock-project-knowledge init \
  --input-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer"}' \
  --json
```

刷新知识库：

```bash
actiondock plugin invoke actiondock-project-knowledge refresh \
  --input-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer","changedFiles":["src/main/java/demo/OrderController.java"]}' \
  --json
```

导入手工资料：

```bash
actiondock plugin invoke actiondock-project-knowledge ingest \
  --input-json '{"repoPath":"/path/to/repo","aiProfile":"project-knowledge-writer","sources":["docs/raw-note.md"]}' \
  --json
```

单独校验：

```bash
actiondock plugin invoke actiondock-project-knowledge validate \
  --input-json '{"repoPath":"/path/to/repo"}' \
  --json
```

## 结果解释

- action 返回 `status=ACCEPTED` 和 `runId`：任务已进入后台执行。
- `getRun` 返回 `status=SUCCESS`：Agent 已完成，质量门通过。
- run result 中 `status=NEEDS_REVIEW`：Agent 已完成，但正式正文校验未通过；文件不会自动回滚。
- `status=FAILED`：Agent 执行或编排流程异常。

## 边界

- 不自动 stage、commit、push 或创建 PR。
- 不绕过插件直接维护 `ACTIONDOCK.md` 或 `.knowledge_base/`。
- 不依赖 staging、state.json、fingerprint 或报告文件。
- 对证据不足项，必须在正文中说明边界，不伪装成确定事实。
