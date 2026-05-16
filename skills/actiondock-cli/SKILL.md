---
name: actiondock-cli
description: 使用 ActionDock CLI 完成脚本的作者态闭环、已发布脚本执行、Webhook 配置、插件查看与调用、项目知识入口解析，以及围绕脚本源码中的 plugins.invoke(...) / scripts.invoke(...) 提供参考。适用于创建、调试、发布脚本，以及查找、运行、管理 Webhook、插件、定时任务、共享状态和项目知识库等日常使用场景。
---

# ActionDock CLI

仓库地址：https://github.com/team4u/actiondock

## 环境检查

如果在执行actiondock过程中失败，请先检查环境是否就绪

### 检查 CLI 是否已安装

```bash
actiondock script list
```

- 如果返回成功 → CLI 已安装，继续下一步。
- 如果找不到命令 → 执行安装：
- 如果server连接失败 → 提醒用户手动启动，等待用户确认启动后再继续：ActionDock Server 未运行，请手动启动：`actiondock server`

```bash
npm i -g actiondock
```

## 主流程文档

- **作者态闭环**：创建脚本、调试、修复并发布 → 读取 `references/script-authoring.md`
- **日常执行**：查找脚本、运行已发布脚本 → 读取 `references/script-execution.md`
- **Webhook**：配置 Webhook 与已发布脚本的一对一绑定，按固定地址接收请求 → 读取 `references/event-framework.md`
- **项目知识库**：解析项目仓库，先读 `ACTIONDOCK.md`，再按文档指引检索项目内容 → 读取 `references/project-knowledge.md`
- **知识源安装**：从 CAPABILITY 仓库发现并安装团队知识源指针 → 读取 `references/project-knowledge.md`

如果用户要编写 Python 脚本，且需求涉及第三方 PyPI 依赖、镜像源或 `requirements.txt`，作者态阶段仍读取 `references/script-authoring.md`，但必须按其中的 `pythonRequirements` / `requirements.txt` 约定一起产出并通过 CLI 提交。

## 命令参考文档（按需加载）

以下模块不绑定特定流程，作者态和日常执行都会用到，根据用户意图按需读取：

| 用户意图 | 子文档 |
|----------|--------|
| "调用插件" / "插件动作" / "plugin invoke" / "actiondock-ai" | `references/plugin-usage.md` |
| "脚本里调插件" / "脚本里调脚本" / "plugins.invoke" / "scripts.invoke" | `references/script-runtime-calls.md` |
| "Webhook" / "webhook" / "固定地址" | `references/event-framework.md` |
| "项目仓库" / "项目知识库" / "ACTIONDOCK.md" / "resolve --repository-id" | `references/project-knowledge.md` |
| "查看执行结果" / "执行历史" / "清空执行记录" | `references/execution-history.md` |
| "定时任务" / "定时执行" / "cron" / "schedule" | `references/schedule-management.md` |
| "共享状态" / "state" / "命名空间" | `references/state-management.md` |
| "日志" / "log" / "脚本日志" / "打印日志" | `references/script-logging.md` |

## 意图路由

| 用户意图 | 加载文档 |
|----------|----------|
| "帮我写一个脚本" / "创建脚本" / "从零做一个" | 作者态 |
| "发布脚本" / "调试脚本" / "patch 脚本" | 作者态 |
| "脚本里调用插件" / "脚本里调用脚本" / "plugins.invoke" / "scripts.invoke" | 作者态 + `references/script-runtime-calls.md` |
| "创建 Webhook" / "测试 webhook" / "调用 webhook" | `references/event-framework.md` |
| "分析某个项目" / "读取项目知识库" / "项目里的退款流程" / "项目数据库文档" | `references/project-knowledge.md` |
| "执行脚本" / "跑一下脚本" / "运行 xxx" | 日常执行 |
| "有哪些脚本" / "列出脚本" / "脚本入参" | 日常执行 |
| "调用插件" / "看插件动作" / "插件参数" | `references/plugin-usage.md` |
| "脚本里打日志" / "log.info" / "log.debug" / "log.warn" / "log.error" | `references/script-logging.md` |

如果用户意图同时涉及多个模块（如"创建脚本并定时运行"、"写 Webhook 脚本并创建 Webhook"），先完成上游产物，再按需加载命令参考文档。

如果需求同时涉及 CLI 调用和脚本源码内互调：

- CLI 插件调用 → 读取 `references/plugin-usage.md`
- 脚本源码内 `plugins.invoke(...)` / `scripts.invoke(...)` → 读取 `references/script-runtime-calls.md`
- Webhook 对象创建 / 测试 / 观测 → 读取 `references/event-framework.md`
- 项目知识入口定位 / `ACTIONDOCK.md` / 项目任务文档检索 → 读取 `references/project-knowledge.md`

如果要通过 CLI 配完整 Webhook 链路，推荐顺序固定为：

1. 创建并发布 Webhook 脚本
2. 创建 `webhook`
3. `webhook invoke`
4. `execution get`

---

## 通用原则

- 默认使用 `--json`，让输出稳定可机读。
- 默认连接本机服务 `http://127.0.0.1:5177`，本地使用不要要求用户先配置连接；只有连接其他 Server、保存 Token 或频繁切换多个 Server 时，才使用 `actiondock config add/use/list` 管理 profile，临时切换用 `--profile <name>`。
- 第一次执行已发布脚本前，通过 `script schema <id>` 获取入参，避免用 `get` 查看脚本细节。
- 项目相关任务必须先解析项目仓库：`actiondock repository resolve --repository-id <repositoryId> --json`。
- 如果项目仓库是 `GIT` 类型且本地副本还没准备好，先执行 `actiondock repository sync <repositoryId>`。
- 先读 `ACTIONDOCK.md`，再按正文里给出的入口文件、目录和关键词搜索；不要一上来就全仓库扫源码。
- 如果 `ACTIONDOCK.md` 已明确说不要优先搜索 `dist`、`build`、`node_modules`，就遵守它。
- Webhook 相关对象优先使用 `--definition-file`、`--payload-file`，不要把大段 JSON 直接内联到命令里。
- `webhook update` 默认按 CLI 侧“先读取当前对象，再深度合并 patch，再 PUT”的方式理解，不要假设局部 patch 会由服务端自动合并。
