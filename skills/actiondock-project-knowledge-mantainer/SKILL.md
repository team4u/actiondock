---
name: actiondock-project-knowledge-mantainer
description: 通过 ActionDock 项目知识库插件初始化、刷新、恢复或校验本地代码仓库的项目知识库。
---

# 项目知识库维护器

## 目标

当用户要求初始化、刷新、恢复或校验项目知识库时，不要手工按模板写文档。应调用平台插件 `actiondock-project-knowledge`，由插件负责流程编排、checkpoint、执行器选择、正式落盘、报告和质量门。

Skill 只负责判断何时调用插件、准备输入、解释插件返回结果。

## 标准调用

必需输入：

- `repoPath`：目标仓库根目录

常用可选输入：

- `operation`：`init` 或 `refresh`；未提供时交给插件自动判断
- `evidenceFiles`：补充证据文件或目录
- `resume`：是否从 checkpoint 继续
- `executor`：`builtin-agent`、`external-cli` 或 `auto`
- `agentProfile`：内置 Agent profile
- `externalCommandProfile`：外部命令 profile，例如 `claude-code`
- `dryRun`：只规划不正式写入

先规划：

```bash
actiondock plugin invoke actiondock-project-knowledge planMaintenance \
  --input-json '{"repoPath":"/path/to/repo","operation":"refresh"}' \
  --json
```

再执行：

```bash
actiondock plugin invoke actiondock-project-knowledge runMaintenance \
  --input-json '{"repoPath":"/path/to/repo","operation":"refresh","executor":"builtin-agent","resume":true}' \
  --json
```

查询运行状态：

```bash
actiondock plugin invoke actiondock-project-knowledge getRun \
  --input-json '{"repoPath":"/path/to/repo"}' \
  --json
```

单独校验：

```bash
actiondock plugin invoke actiondock-project-knowledge validateKnowledge \
  --input-json '{"repoPath":"/path/to/repo"}' \
  --json
```

## 结果解释

- `status=SUCCESS`：维护完成，向用户说明入口、报告和变更文件。
- `status=NEEDS_REVIEW`：维护已落盘但质量门发现问题，列出 `needsReviewItems` 和报告路径。
- `status=PLANNED`：只完成规划，说明将激活的域、输出路径和警告。
- `status=NOT_FOUND`：没有可读取的运行记录，建议先执行 `planMaintenance` 或 `runMaintenance`。

## 边界

- 不自动 stage、commit、push 或创建 PR。
- 不绕过插件直接维护 `ACTIONDOCK.md`、`docs/`、报告或 `.actiondock/.knowledge-tmp/`。
- 不把 `.actiondock/.knowledge-tmp/` 内容作为长期事实来源。
- 如果插件返回质量门问题，必须把问题和报告路径反馈给用户，不要伪装成完全成功。
