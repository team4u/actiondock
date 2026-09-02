# 核心概览与双轨导引

ActionDock 2.0 是面向 AI Agent 的 **Action 与 Skill 开发、测试、构建与分发工具链**。

它连接了**工具创作者（开发者）**与**智能体使用者（消费者）**，实现了“一次编写，处处交付”。

---

## 核心架构与全景生命周期

```text
               开发者 / 创作者
               ┌────────────────────────────────────────────────────────┐
               │  ac init ──► defineAction ──► Playbook ──► ac test     │
               │                             │                          │
               │                      ac export skill                   │
               └─────────────────────────────┬──────────────────────────┘
                                             │ 交付物 (Skill / Git / Binary)
                                             ▼
               ┌────────────────────────────────────────────────────────┐
               │                     使用者 / 消费者                     │
               │  从 Git 克隆 / 拿到导出的 Skill 包 / 下载独立可执行文件  │
               │                                                        │
               │  • 作为 Agent Skill (Claude Code / Antigravity)         │
               │  • 作为 MCP 服务直连 (Cursor / Windsurf)                │
               │  • 作为 零依赖 CLI (单文件免环境运行)                  │
               │  • 作为 HTTP 微服务 (远程 API 异步调度)                 │
               └────────────────────────────────────────────────────────┘
```

---

## 阅读路径导引

根据您当前的角色与任务诉求，前往对应板块：

### 使用者与智能体操作者
> 目标：从 Git 克隆了一个 Action 项目，或者拿到了导出的 Skill 包，需要在 IDE 或 Agent 中运行。

- [消费与接入总览](../consumer/overview.md)：对比接入姿态，选择适合的使用方式。
- [接入 Claude Code / Antigravity 技能库](../consumer/use-as-skill.md)：将导出的 Skill 放入技能目录，实现大模型自主调度。
- [接入 Cursor / Windsurf / IDE (MCP 服务)](../consumer/use-as-mcp.md)：作为 MCP STDIO Server 直连 IDE。
- [独立二进制单文件运行](../consumer/standalone-run.md)：在无 Node.js / Bun 的生产服务器或沙箱免依赖运行。
- [消费端配置与凭证注入](../consumer/configuration.md)：注入 API Token、环境变量与 SQLite 持久化配置。

---

### 开发者与工具创作者
> 目标：从零开发强类型校验的原子能力和领域规程，并打包分发给团队和 Agent。

- [快速上手开发](../developer/quick-start.md)：初始化、编写 `defineAction` 与本地试跑。
- [深入业务 Action 实战](../developer/first-action.md)：状态持久化 (`ctx.state`)、配置读取 (`ctx.config`) 与外部 API 调用。
- [编写 Playbook 规程](../developer/playbooks.md)：为 AI Agent 编写领域专家的标准作业步骤。
- [单元测试与沙箱验证](../developer/testing.md)：基于 `createTestRuntime` 纯内存测试。
- [构建、打包与 Skill 导出](../developer/build-and-export.md)：编译独立单文件可执行程序，按 Playbook 裁剪导出 Agent Skill 并发布。
