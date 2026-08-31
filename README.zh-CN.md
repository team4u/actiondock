# ActionDock

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-67%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
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

AI Agent 工具正在演进为严肃的软件工程。

它们需要严格的 Schema 约束、单元测试、版本控制、可复现构建和多种分发目标 —— 而不是在每个不同的 Agent 平台和运行时里反复复制同一套业务逻辑。

ActionDock 将 Agent 工具视为标准化软件资产：

* **代码即契约（Code as Contract）** — TypeScript + 标准 JSON Schema 一体化定义实现与工具契约，运行时自动严格校验。
* **开箱即测试（Testable by Default）** — 内置纯内存沙箱测试运行时，无需启动 MCP 服务或模拟复杂网络，毫秒级验证。
* **一次编写，多端复用（Build Once）** — 同一份 Action 源码无缝运行于 CLI、MCP、HTTP 服务与独立二进制。
* **便携式分发（Portable Distribution）** — 将 Action Package 编译为零外部依赖的单文件独立二进制（目标机器无需安装 Node.js 或 Bun）。
* **规程化 Agent Skill** — 将原子 Action 与操作规程 Playbook 结合，一键导出为包含领域知识的自包含 Agent Skill。
* **Git 原生（Git Native）** — Action 与 Playbook 均为纯文本文件，天然适配代码评审（Code Review）、分支管理与 CI/CD 流水线。

---

## 快速上手

### 1. 安装命令行工具 (`ac`) 与 SDK

**发布到 npm 后（全局安装）：**
```bash
bun install -g @actiondock/cli
```

**本地源码模式（未发布到 npm 时）：**
```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
bun install

# 1. 注册全局 ac 命令行
cd packages/cli && bun link

# 2. 注册全局 @actiondock/sdk
cd ../sdk && bun link
```

### 2. 初始化 Action Package

```bash
ac init hello-tools
cd hello-tools

# 如果使用源码模式，链接本地 SDK：
bun link @actiondock/sdk
```

### 3. 创建 Action

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

### 4. 运行、测试与交付

**本地运行：**
```bash
ac run hello --input '{"name":"ActionDock"}'
```

**运行内存测试：**
```bash
ac test
```

**作为 MCP 服务直连 IDE（Claude Code、Cursor、Windsurf）：**
```bash
ac mcp
```

**编译为零依赖单文件独立二进制：**
```bash
ac build
```

**导出为便携式 Agent Skill：**
```bash
ac export skill
```

> **一个 Action，多端运行，单一契约。**

---

## Action + Playbook

ActionDock 倡导**能力（Capability）与规程（Procedure）分离**：

```text
Action   = 智能体「能做什么」 (Capability)
Playbook = 智能体「该怎么做」 (Procedure)

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

> **One implementation, multiple delivery targets.**

---

## 方案与竞品对比

| 功能 / 评估维度 | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| **MCP Server（STDIO 与 HTTP）** | ✅ | ✅ | ✅ | ✅ |
| **原生 TypeScript 支持** | ✅ | ✅ | ✅ | ✅ / Python |
| **纯内存单测运行时** | ✅ | ✅ | ✅ | ✅ |
| **零依赖单文件独立二进制** | **✅** | — | — | — |
| **Agent Skill 导出（含 SOP 规程）** | **✅** | — | — | — |
| **Playbook 规程化编排** | **✅** | — | — | — |
| **远程 HTTP 调度服务** | ✅ | ✅ | ✅ | ✅ |
| **Git 原生包架构** | ✅ | ✅ | ✅ | ✅ |
| **托管 OAuth** | — | — | — | **✅** |
| **托管云平台** | — | ✅ | — | **✅** |

---

## 分发目标

```text
分发目标 (Distribution Targets)

✅ 独立可执行文件 (ac build -> 单文件自包含二进制)
✅ Agent Skill    (ac export skill -> 便携式 Skill 交付包)
⬜ MCPB 扩展包    (桌面端一键安装格式 - 规划中)
⬜ Docker 容器镜像 (标准容器镜像 - 规划中)
⬜ npm 依赖包     (标准 Node 库导出 - 规划中)
```

---

## 模块分层与代码结构

ActionDock 采用清晰的 Monorepo 分层架构：

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

- **新手入门 (Getting Started)**
  - [环境安装](docs/getting-started/installation.md)
  - [快速开始](docs/getting-started/quick-start.md)
  - [编写第一个 Action](docs/getting-started/first-action.md)
- **核心概念 (Concepts)**
  - [Action Package 核心抽象](docs/concepts/action-package.md) *(核心架构模型)*
  - [Action 原子工具](docs/concepts/action.md)
  - [ActionContext 上下文机制](docs/concepts/action-context.md)
  - [Playbook 规程规范](docs/concepts/playbook.md)
  - [Agent Skill 技能交付包](docs/concepts/skill.md)
- **实践指南 (Guides)**
  - [测试与验证指南](docs/guides/testing.md)
  - [MCP 协议集成](docs/guides/mcp.md)
  - [独立二进制编译构建](docs/guides/standalone-build.md)
  - [Agent Skill 导出分发](docs/guides/skill-export.md)
  - [HTTP 服务与远程运行](docs/guides/http-server.md)
  - [SQLite 存储与状态管理](docs/guides/storage.md)
  - [多环境 Profile 与远程调度](docs/guides/profiles.md)
- **参考手册 (Reference)**
  - [CLI 命令行参考手册](docs/reference/cli.md)
  - [配置解析优先级](docs/reference/config.md)
  - [SDK Action API 手册](docs/reference/action-api.md)
  - [错误代码与排错手册](docs/reference/error-codes.md)
- **底层架构 (Architecture)**
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
