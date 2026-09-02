# ActionDock

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-81%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[English](README.md) | **简体中文**

**一次编写，全模态交付。**

用于构建、测试与分发 AI Agent 工具的 TypeScript 工具链，支持交付为 **MCP 服务、Agent Skill、HTTP 服务或独立二进制**。

```text
TypeScript Action
       │
       ├── ac run          # 本地 CLI 执行
       ├── ac test         # 毫秒级内存单测
       ├── ac mcp          # STDIO / HTTP MCP 服务
       ├── ac serve        # 远程 HTTP 微服务
       ├── ac export skill # 自包含 Agent Skill
       └── ac build        # 零依赖单文件独立二进制
              ↓
          独立可执行文件
```

---

## 为什么选择 ActionDock？

AI 智能体工具正在演进为严肃的软件工程。

它们需要严格的 Schema 约束、单元测试、版本控制、可复现构建和多种分发目标，而不是在每个不同的智能体平台和运行时里反复复制同一套业务逻辑。

ActionDock 将智能体工具视为标准化软件资产：

- **代码即契约** — TypeScript 与标准 JSON Schema 一体化定义实现与工具契约，运行时自动严格校验。
- **开箱即测试** — 内置纯内存沙箱测试运行时，无需启动 MCP 服务或模拟复杂网络，毫秒级验证。
- **一次编写，多端复用** — 同一份 Action 源码无缝运行于 CLI、MCP、HTTP 服务与独立二进制。
- **便携式分发** — 将 Action Package 编译为零外部依赖的单文件独立二进制，目标机器无需安装 Node.js 或 Bun。
- **规程化 Agent Skill** — 将原子 Action 与操作规程 Playbook 结合，一键导出为包含领域知识的自包含 Agent Skill。
- **Git 原生** — Action 与 Playbook 均为纯文本文件，天然适配代码评审、分支管理与持续集成流水线。

---

## 快速上手

> **运行环境**：需要 [Bun](https://bun.sh/) >= 1.2.0。

### 安装命令行工具

```bash
# 安装 Bun 运行时（如尚未安装）
npm install -g bun

# 全局安装 ActionDock CLI
npm install -g @actiondock/cli
```

### 初始化 Action Package

```bash
ac init hello-tools
cd hello-tools
bun install
```

### 创建 Action

编写 `actions/hello.ts`：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "hello",
  description: "打招呼示例工具",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "被问候者的名字" },
    },
    required: ["name"],
  },

  async run(input) {
    return {
      message: `Hello ${input.name}!`,
    };
  },
});
```

### 运行、测试与交付

- 本地运行：
```bash
ac run hello --input '{"name":"ActionDock"}'
```

- 运行内存测试：
```bash
ac test
```

- 作为 MCP 服务直连 IDE（Claude Code、Cursor、Windsurf）：
```bash
ac mcp
```

- 编译为零依赖单文件独立二进制：
```bash
ac build
```

- 导出为便携式 Agent Skill：
```bash
ac export skill
```

> **一个 Action，多端运行，单一契约。**

---

## Action 与 Playbook

ActionDock 倡导能力与规程分离：

```text
Action   = 智能体「能做什么」
Playbook = 智能体「该怎么做」

             ↓

        Agent Skill
```

例如：

```text
actions/
├── get-pr.ts          # 获取 PR 详情
├── create-comment.ts  # 发表 Review 评论
└── merge-pr.ts        # 执行合并操作

playbooks/
└── review-pr.md       # PR 自动化评审操作规程与红线拦截
```

- **Action** 提供确定性、类型安全、带严格 Schema 校验的原子能力。
- **Playbook** 描述高层操作规程、业务约束、红线拦截与操作知识。
- 两者共同构成 **Action Package**，可一键导出为面向 AI Agent 的自包含 **Agent Skill**。

---

## 生态定位

ActionDock 不是 Agent 框架，也不是可视化工作流画布。它专注于 **AI Agent 工具的开发、测试与交付生命周期**。

```text
                 Agent / 大语言模型
                         │
                ┌────────┴────────┐
                │                 │
             MCP 客户端       Agent Skill
                │                 │
                └────────┬────────┘
                         │
                    ActionDock
                         │
            ┌────────────┼────────────┐
            │            │            │
          Action       Action       Action
            │            │            │
         业务 API      数据库       内部微服务
```

---

## 一次实现，全模态交付

```text
                  ┌─ CLI 本地执行 (`ac run`)
                  │
                  ├─ MCP 协议直连 (`ac mcp`)
actions/*.ts ─────┼─ HTTP 微服务 (`ac serve`)
                  │
                  ├─ Agent Skill 导出 (`ac export skill`)
                  │
                  └─ 单文件独立二进制 (`ac build`)
```

> **一次实现，全模态交付。**

---

## 方案与竞品对比

| 功能与评估维度 | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| MCP 服务（STDIO 与 HTTP） | 支持 | 支持 | 支持 | 支持 |
| 原生 TypeScript 支持 | 支持 | 支持 | 支持 | 支持 / Python |
| 纯内存单测运行时 | 支持 | 支持 | 支持 | 支持 |
| 零依赖单文件独立二进制 | 支持 | — | — | — |
| Agent Skill 导出（含规程） | 支持 | — | — | — |
| Playbook 规程化编排 | 支持 | — | — | — |
| 远程 HTTP 调度服务 | 支持 | 支持 | 支持 | 支持 |
| Git 原生包架构 | 支持 | 支持 | 支持 | 支持 |
| 托管 OAuth | — | — | — | 支持 |
| 托管云平台 | — | 支持 | — | 支持 |

---

## 分发目标

- npm 模块生态包（`@actiondock/sdk`、`@actiondock/core`、`@actiondock/mcp`、`@actiondock/cli`）
- 独立可执行文件（`ac build` 编译为单文件自包含二进制）
- Agent Skill（`ac export skill` 导出为便携式 Skill 交付包）
- MCPB 扩展包（桌面端一键安装格式，规划中）
- Docker 容器镜像（标准容器镜像，规划中）

---

## 模块分层与代码结构

ActionDock 采用清晰的分层架构：

```text
actiondock/
├── packages/
│   ├── sdk/          # @actiondock/sdk：极简 SDK（defineAction, ActionContext, createTestRuntime）
│   ├── core/         # @actiondock/core：核心引擎（Runner, Storage, Schema, Build, Export）
│   ├── mcp/          # @actiondock/mcp：MCP 适配器（STDIO / HTTP / Tasks 异步扩展）
│   └── cli/          # @actiondock/cli：命令行门面工具链（ac）
├── examples/
│   └── github-tools/ # 官方完整示例包（包含 GitHub PR 工具集与评审 Playbook）
└── docs/             # 官方技术文档中心
```

---

## 文档导航

请参阅 [官方技术文档中心](docs/README.md) 获取详尽指南：

- **快速概览**
  - [环境安装](docs/getting-started/installation.md)
  - [核心概览与双轨导引](docs/getting-started/overview.md)
- **使用者指南**
  - [消费与接入总览](docs/consumer/overview.md)
  - [接入 Claude Code / Antigravity 技能库](docs/consumer/use-as-skill.md)
  - [接入 Cursor / Windsurf / IDE (MCP 服务)](docs/consumer/use-as-mcp.md)
  - [独立二进制单文件运行](docs/consumer/standalone-run.md)
  - [HTTP 远程微服务与 API 调度](docs/consumer/http-service.md)
  - [消费端配置与凭证注入](docs/consumer/configuration.md)
- **开发者指南**
  - [快速上手开发](docs/developer/quick-start.md)
  - [深入业务 Action 开发](docs/developer/first-action.md)
  - [编写 Playbook 规程](docs/developer/playbooks.md)
  - [单元测试与沙箱验证](docs/developer/testing.md)
  - [状态持久化与 SQLite 存储](docs/developer/storage.md)
  - [多环境 Profile 与远程调度](docs/developer/profiles.md)
  - [构建、打包与 Skill 导出](docs/developer/build-and-export.md)
- **核心概念**
  - [Action Package 核心抽象](docs/concepts/action-package.md)
  - [Action 原子工具](docs/concepts/action.md)
  - [ActionContext 上下文机制](docs/concepts/action-context.md)
  - [Playbook 规程规范](docs/concepts/playbook.md)
  - [Agent Skill 技能交付包](docs/concepts/skill.md)
- **参考手册**
  - [CLI 命令行参考手册](docs/reference/cli.md)
  - [配置解析优先级](docs/reference/config.md)
  - [SDK Action API 手册](docs/reference/action-api.md)
  - [错误代码与排错手册](docs/reference/error-codes.md)
  - [1.0 到 2.0 迁移指南](docs/reference/v1-to-v2-migration.md)
- **底层架构**
  - [Runtime 运行时执行引擎](docs/architecture/runtime.md)
  - [Stdout/Stderr 物理通道隔离](docs/architecture/stdout-stderr.md)
  - [安全加固设计模型](docs/architecture/security.md)

---

## 验证与测试

```bash
# 执行全量单元与集成测试（67 个测试用例全部通过）
bun test

# 执行全量 TypeScript 类型检查
bun run typecheck
```

---

## 开源协议

本项目采用 [Apache-2.0](LICENSE) 开源协议。
