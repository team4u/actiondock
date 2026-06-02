---
name: actiondock-cli
description: 当任务涉及 ActionDock 平台能力资产或项目上下文时使用，包括脚本、插件、Webhook、定时任务、共享状态、项目知识库、任务手册 Playbook、能力包，以及需要通过 ActionDock 协助 AI 理解、管理或使用这些能力的场景。
---

# ActionDock CLI

仓库地址：https://github.com/team4u/actiondock

## 环境检查

本 Skill 适配 `actiondock` CLI `0.1.32` 或以上版本。

如果在执行actiondock过程中失败，请先检查环境是否就绪

### 检查 CLI 是否已安装

```bash
actiondock --version
```

- 如果返回成功 → CLI 已安装，继续检查 Server。
- 如果找不到命令 → 执行安装：

```bash
npm i -g actiondock
```

### 检查 ActionDock Server 是否运行

```bash
actiondock health --json
```

- 如果返回成功且 `status` 为 `UP` → Server 可用，继续下一步。
- 如果server连接失败 → 提醒用户手动启动，等待用户确认启动后再继续：ActionDock Server 未运行，请手动启动：`actiondock server`

## 主流程文档

- **作者态闭环**：创建脚本、调试、修复并发布 → 读取 `references/script-authoring.md`
- **日常执行**：查找脚本、运行已发布脚本 → 读取 `references/script-execution.md`
- **Webhook**：配置 Webhook 与已发布脚本的一对一绑定，按固定地址接收请求 → 读取 `references/event-framework.md`
- **项目知识库**：作为 Playbook 下游的强制项目知识检索协议；进入项目知识、文档或源码搜索前必须实际读取 → `references/project-knowledge.md`
- **知识源安装**：从 CAPABILITY 仓库发现并安装团队知识源指针 → 读取 `references/project-knowledge.md`
- **任务手册（Playbook）**：搜索候选任务手册，读取完整详情，维护 Playbook；涉及项目知识时再强制读取 `references/project-knowledge.md` → 读取 `references/playbook.md`

如果用户要编写 Python 脚本，且需求涉及第三方 PyPI 依赖、镜像源或 `requirements.txt`，作者态阶段仍读取 `references/script-authoring.md`，但必须按其中的 `pythonRequirements` / `requirements.txt` 约定一起产出并通过 CLI 提交。

## 命令参考文档（按需加载）

以下模块不绑定特定流程，作者态和日常执行都会用到，根据用户意图按需读取：

| 用户意图 | 子文档 |
|----------|--------|
| "调用插件" / "插件动作" / "plugin invoke" / "actiondock-ai" | `references/plugin-usage.md` |
| "脚本里调插件" / "脚本里调脚本" / "plugins.invoke" / "scripts.invoke" | `references/script-runtime-calls.md` |
| "Webhook" / "webhook" / "固定地址" | `references/event-framework.md` |
| "项目仓库" / "项目知识库" / "ACTIONDOCK.md" / "resolve --repository-id" / "知识源安装" | `references/project-knowledge.md` |
| "任务手册" / "Playbook" / "任务导览" / "搜索任务手册" / "关联脚本" | `references/playbook.md` |
| "关联知识" / "业务排查" / "项目流程" / "项目文档" / "项目源码" | 先 `references/playbook.md`；进入项目知识前必须实际读取 `references/project-knowledge.md` |
| "查看执行结果" / "执行历史" / "清空执行记录" | `references/execution-history.md` |
| "定时任务" / "定时执行" / "cron" / "schedule" | `references/schedule-management.md` |
| "共享状态" / "state" / "命名空间" | `references/state-management.md` |
| "配置值" / "config value" / "config-value" | `references/config-value.md` |
| "日志" / "log" / "脚本日志" / "打印日志" | `references/script-logging.md` |

## 意图路由

| 用户意图 | 加载文档 |
|----------|----------|
| "帮我写一个脚本" / "创建脚本" / "从零做一个" | 作者态 |
| "发布脚本" / "调试脚本" / "patch 脚本" | 作者态 |
| "脚本里调用插件" / "脚本里调用脚本" / "plugins.invoke" / "scripts.invoke" | 作者态 + `references/script-runtime-calls.md` |
| "创建 Webhook" / "测试 webhook" / "调用 webhook" | `references/event-framework.md` |
| "分析某个业务项目" / "项目里的退款流程" / "项目数据库文档" / "排查项目问题" | 先 `references/playbook.md`；命中 Playbook 或进入 fallback 后，如需项目知识/文档/源码，必须实际读取 `references/project-knowledge.md` |
| "解析项目仓库" / "读取 ACTIONDOCK.md" / "安装知识源" / "repository resolve" | `references/project-knowledge.md` |
| "任务手册" / "Playbook" / "搜索任务手册" / "任务导览" / "关联脚本" | `references/playbook.md` |
| "执行脚本" / "跑一下脚本" / "运行 xxx" | 日常执行 |
| "有哪些脚本" / "列出脚本" / "脚本入参" | 日常执行 |
| "调用插件" / "看插件动作" / "插件参数" | `references/plugin-usage.md` |
| "查看配置值" / "设置配置" / "config value" | `references/config-value.md` |
| "脚本里打日志" / "log.info" / "log.debug" / "log.warn" / "log.error" | `references/script-logging.md` |

如果用户意图同时涉及多个模块（如"创建脚本并定时运行"、"写 Webhook 脚本并创建 Webhook"），先完成上游产物，再按需加载命令参考文档。

如果用户是在问某个业务项目里的流程、数据库、接口、日志、告警或排障路径，默认先进入 `references/playbook.md` 搜索任务手册；命中 Playbook、进入通用 fallback，或任何一步需要读取项目知识、项目文档、项目源码、`ACTIONDOCK.md` 或知识引用时，必须先实际读取 `references/project-knowledge.md`，再继续项目知识检索。

如果需求同时涉及 CLI 调用和脚本源码内互调：

- CLI 插件调用 → 读取 `references/plugin-usage.md`
- 脚本源码内 `plugins.invoke(...)` / `scripts.invoke(...)` → 读取 `references/script-runtime-calls.md`
- Webhook 对象创建 / 测试 / 观测 → 读取 `references/event-framework.md`
- 业务项目任务 / 排障 / 流程查询 → 先读取 `references/playbook.md`；进入项目知识前必须实际读取 `references/project-knowledge.md`
- 项目知识入口定位 / `ACTIONDOCK.md` / 项目任务文档检索 → 作为 Playbook 下游读取 `references/project-knowledge.md`
- 任务手册搜索 / 详情读取 / Playbook 作者态维护 → 读取 `references/playbook.md`

如果要通过 CLI 配完整 Webhook 链路，推荐顺序固定为：

1. 创建并发布 Webhook 脚本
2. 创建 `webhook`
3. `webhook invoke`
4. `execution get`

---

## 通用原则

- 默认使用 `--json`，让输出稳定可机读。
- 业务资产类 list 命令优先用 `--intent <regex>` 收窄候选，例如 `script list`、`plugin list`、`repository list`、`repository:knowledge-list`、`playbook list`、`webhook list`、`schedule list`、`script preset list`、`config-value list` 以及仓库资产的 `repository-list`。`--intent` 未命中时 CLI 会自动退回同一过滤条件下的全量列表，输出结构不变。
- 对可能很长的 JSON 输出，默认写入文件再读取文件内容，例如 `--json --output-file /tmp/actiondock-result.json --overwrite-output`。适用场景包括 `script run --response-view debug`、`execution get`、`plugin invoke`、`playbook get`、`repository resolve` 和项目知识浏览结果；不要让长 JSON 直接占满终端。
- 默认连接本机服务 `http://127.0.0.1:5177`，本地使用不要要求用户先配置连接；只有连接其他 Server、保存 Token 或频繁切换多个 Server 时，才使用 `actiondock config add/use/list` 管理 profile，临时切换用 `--profile <name>`。
- 第一次执行已发布脚本前，通过 `script schema <id>` 获取入参，避免用 `get` 查看脚本细节。
- 当用户查看脚本 `inputSchema` 或插件 action `inputSchema` 时，不只复述字段名；要直接说明哪些顶层简单字段可扁平为 CLI flag，哪些对象/数组字段必须继续使用 JSON 或文件方式传入。
- 解释 schema 时默认给 1 条对应 CLI 示例，优先展示最推荐的主路径：纯简单字段用扁平 flag；包含对象/数组等复杂字段时，直接示例 `--input-json` / `--input-file`（脚本）或 `--args-json` / `--args-file`（插件）。
- 不要把对象或数组字段解释成多级 flag；混合 schema 只需在文字里说明“简单字段可扁平、复杂字段走 JSON”，示例仍保持 1 条主路径命令。
- 业务项目相关任务必须先搜索 Playbook；Playbook 命中或进入通用 fallback 后，如果需要项目知识、项目文档或源码搜索，必须实际读取 `references/project-knowledge.md`。不要只凭本文件或 `references/playbook.md` 的摘要继续项目知识检索。
- 项目仓库解析、同步、`ACTIONDOCK.md` 阅读、`actiondock-workspace` 使用、定向搜索、源码确认和禁搜目录规则，都以 `references/project-knowledge.md` 为准。
- Webhook 相关对象优先使用 `--definition-file`、`--payload-file`，不要把大段 JSON 直接内联到命令里。
- `webhook update` 默认按 CLI 侧“先读取当前对象，再深度合并 patch，再 PUT”的方式理解，不要假设局部 patch 会由服务端自动合并。
