# 参考手册：1.0 到 2.0 架构对比与迁移指南

ActionDock 2.0 完成了向现代化、轻量化、Agent 原生架构的全面重构。

---

## 核心架构维度对比

| 架构维度 | ActionDock 1.0 (旧版) | ActionDock 2.0 (全新工具链) |
| :--- | :--- | :--- |
| **技术栈与运行时** | Java / Spring Boot / JVM | **TypeScript 原生 / Bun 原生运行时** |
| **架构定位** | 中心化微服务网关平台 | **分布式 AI Agent 工具链与独立编译器** |
| **工具定义形态** | 基于 Java 注解 / Spring Controller | **defineAction + JSON Schema 代码即契约** |
| **分发与交付** | 部署庞大的 Spring 容器或 War 包 | **单文件零依赖独立二进制 (ac build) + Agent Skill** |
| **测试与验证** | 启动庞大的 Spring 上下文 (>10s) | **纯内存毫秒级沙箱测试 (createTestRuntime, <5ms)** |
| **协议与生态** | 私有 REST / WebSocket 协议 | **原生 MCP 标准 (STDIO/HTTP) + AI Agent Skill 规范** |
| **持久化后端** | 外部 MySQL / PostgreSQL 依赖 | **轻量内嵌式 SQLite (bun:sqlite) 零运维** |

---

## 迁移指导：AI 原生自动化重构

在 ActionDock 2.0 体系中，从 1.0 版本迁移无需人工手动逐行重写代码。借助 AI Agent 与 1.0 / 2.0 双版本 Skill，可实现端到端的一键自动化复刻：

- **读取 1.0 旧版资产**：让 AI Agent 挂载 1.0 分支的旧版 Skill（`skills/actiondock-cli/SKILL.md`）或直接读取 1.0 仓库中待迁移的脚本、插件、Webhook、Playbook 及数据库配置。
- **挂载 2.0 全新 Skill**：为 AI Agent 引入 ActionDock 2.0 开发 Skill（`skills/actiondock/SKILL.md`），使 Agent 掌握 2.0 的架构规范、API 契约与构建指令。
- **一键指令复刻功能**：向 Agent 发送迁移 Prompt，让其自动将 1.0 的脚本执行逻辑与入参定义转换为基于 `@actiondock/sdk` 的 TypeScript `defineAction`、JSON Schema 校验契约、`ActionContext`（`ctx.config`、`ctx.state`、`execCli` 等）以及标准 Playbook 规程。
- **内存测试与验证闭环**：指导 Agent 自动编写单元测试并执行 `bun test` 与 `ac action validate`，确保入参校验与业务输出与原 1.0 功能严格一致。
- **独立编译交付**：验证通过后，通过 `ac build` 编译为全平台单文件二进制或通过 `ac export skill` 导出为标准 Agent Skill。

### 迁移 Prompt 参考示例

```text
你是一个精通 ActionDock 2.0 重构的专家。
请读取 1.0 分支中的待迁移脚本/插件代码：<1.0 脚本路径或代码>

请严格遵循 ActionDock 2.0 规范复刻该功能：
- 使用 defineAction 声明 Action，补充完整准确的 inputSchema 与 outputSchema；
- 外部 CLI 调用使用 execCli 或 spawnDetached，防止管道死锁；
- 持久化状态改用 ctx.state，配置读取改用 ctx.config；
- 编写配套的 tests/<name>.test.ts 并使用 createTestRuntime 进行内存验证；
- 运行 bun test 确认全部通过。
```
