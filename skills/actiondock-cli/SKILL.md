---
name: actiondock-cli
description: 使用 ActionDock CLI 完成脚本的完整作者态闭环或日常执行已发布脚本。适用于创建、调试、发布脚本，以及查找、运行、管理定时任务和共享状态等日常使用场景。
---

# ActionDock CLI

当用户提到"用 CLI"操作 ActionDock 脚本时，使用这个 skill。

## 前置检查

每次使用本 skill 前，必须先完成以下两项检查，确保环境就绪后再执行任何命令。

### 1. 检查 CLI 是否已安装

```bash
which actiondock
```

- 如果返回路径 → CLI 已安装，继续下一步。
- 如果无输出 → 执行安装：

```bash
npm i -g @actiondock/cli
```

安装完成后验证 `actiondock --version`，确认可用。

### 2. 检查 Server 是否已安装

```bash
which actiondock-server
```

- 如果返回路径 → Server 已安装，继续。
- 如果无输出 → 执行安装：

```bash
npm i -g @actiondock/server
```

### 3. 检查 Server 是否运行中

```bash
actiondock script list
```

- 如果正常返回 → Server 运行中，可以继续。
- 如果连接失败 → 提醒用户手动启动：

> ActionDock Server 未运行，请手动启动：`actiondock-server`

等待用户确认启动后再继续。

---

根据用户意图选择对应的子文档：

## 主流程文档

- **作者态闭环**：创建脚本、调试、修复并发布 → 读取 `references/script-authoring.md`
- **日常执行**：查找脚本、运行已发布脚本 → 读取 `references/script-execution.md`

## 命令参考文档（按需加载）

以下模块不绑定特定流程，作者态和日常执行都会用到，根据用户意图按需读取：

| 用户意图 | 子文档 |
|----------|--------|
| "查看执行结果" / "执行历史" / "清空执行记录" | `references/execution-history.md` |
| "定时任务" / "定时执行" / "cron" / "schedule" | `references/schedule-management.md` |
| "共享状态" / "state" / "命名空间" | `references/state-management.md` |

## 意图路由

| 用户意图 | 加载文档 |
|----------|----------|
| "帮我写一个脚本" / "创建脚本" / "从零做一个" | 作者态 |
| "发布脚本" / "调试脚本" / "patch 脚本" | 作者态 |
| "执行脚本" / "跑一下脚本" / "运行 xxx" | 日常执行 |
| "有哪些脚本" / "列出脚本" / "脚本入参" | 日常执行 |

如果用户意图同时涉及多个模块（如"创建脚本并定时运行"），先完成作者态闭环，再按需加载命令参考文档。

---

## 通用原则

- 默认使用 `--json`，让输出稳定可机读。
- 查找已有脚本时使用 `script list`，不加 `--json`。
- 第一次执行已发布脚本前，通过 `script schema <id>` 获取入参，避免用 `get` 查看脚本细节。
