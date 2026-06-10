---
name: actiondock-cli
description: 当任务涉及 ActionDock 平台能力资产或项目上下文时使用，包括脚本、插件、Webhook、定时任务、共享状态、项目知识库、任务手册 Playbook、能力包，以及需要通过 ActionDock 协助 AI 理解、管理或使用这些能力的场景。
---

# ActionDock CLI

仓库地址：https://github.com/team4u/actiondock

适配 `actiondock` CLI `0.1.32` 或以上版本。

## 启动检查

执行 CLI 前先确认环境：

```bash
actiondock --version
actiondock health --json
```

- 找不到 `actiondock`：执行 `npm i -g actiondock`。
- `health` 连接失败：提醒用户手动启动 `actiondock server`，等用户确认后继续。

## 必读顺序

1. 先读 `references/common.md`，获取全局 CLI 约定。
2. 再按用户意图只加载相关参考文档。
3. 组合任务先完成上游产物，再加载下游文档。

## 意图路由

| 用户意图 | 加载文档 |
|----------|----------|
| 创建、调试、修复、发布脚本 | `references/script-authoring.md` |
| 执行已发布脚本、查看脚本 schema、查找脚本 | `references/script-execution.md` |
| Python 脚本第三方依赖、镜像源、`requirements.txt` | `references/script-authoring.md` |
| Webhook 创建、测试、调用、排查 | `references/webhook.md` |
| CLI 调用插件、查看插件动作或配置 | `references/plugin-usage.md` |
| 脚本源码内调用插件、脚本、共享状态或本机命令 | `references/script-runtime-calls.md` |
| 业务项目流程、接口、数据库、日志、告警、排障 | 先 `references/playbook.md`；进入项目知识前再实际读取 `references/project-knowledge.md` |
| 项目仓库解析、读取 `ACTIONDOCK.md`、知识源安装 | `references/project-knowledge.md` |
| 任务手册搜索、消费、维护 | `references/playbook.md` |
| 查看执行结果、日志、删除或清空执行历史 | `references/execution-history.md` |
| 定时任务、cron、周期执行 | `references/schedule-management.md` |
| 共享状态、命名空间、CAS | `references/state-management.md` |
| 配置值、仓库默认值、本地覆盖 | `references/config-value.md` |
| 脚本日志写法、日志查看 | `references/script-logging.md` |

## 组合规则

- 业务项目相关任务默认先搜索 Playbook；命中 Playbook、进入 fallback，或需要项目文档/源码/知识引用时，必须实际读取 `project-knowledge.md`。
- CLI 插件调用看 `plugin-usage.md`；脚本源码里的 `plugins.invoke(...)` / `scripts.invoke(...)` 看 `script-runtime-calls.md`。
- 作者态脚本涉及第三方 Python 依赖时，必须按 `script-authoring.md` 产出并提交 `pythonRequirements`。
