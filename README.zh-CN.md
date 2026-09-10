# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-173%20passed-brightgreen.svg)](https://github.com/team4u/actiondock)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[English](README.md) | 简体中文

一次编写，全模态交付。

面向 AI 智能体工具与技能的 TypeScript 研发工具链，支持将工具交付为 MCP 服务、Agent Skill、HTTP 微服务或单文件独立二进制产物。

```text
TypeScript Action
       │
       ├── ad run          # 本地 CLI 执行
       ├── ad test         # 毫秒级沙箱单测
       ├── ad mcp          # STDIO / HTTP MCP 服务
       ├── ad serve        # 远程 HTTP 微服务
       ├── ad export skill # 自包含 Agent Skill 技能包
       └── ad build        # 零依赖单文件独立二进制产物
              ↓
          可执行文件
```

---

## 核心设计理念

在代码大部分由智能体编写的今天，工具研发的瓶颈早已不是写几行胶水代码，而是工程的确定性、质量自愈与免运维交付。

随手手写的临时脚本往往缺乏契约、无法自测，运行起来容易因为环境配置缺失或版本冲突而中断；普通封装库往往只负责把函数暴露给模型，缺乏业务规程约束，极易导致模型产生幻觉或引发非预期的破坏性操作。

ActionDock 将智能体工具确立为工业级标准化软件资产：

- **人定规程，智能体写实现**：人负责在操作规程中划定业务边界、调用时序与安全红线；智能体根据契约编写具体的原子动作实现。
- **纯内存沙箱与自愈闭环**：基于纯内存沙箱测试环境与确定性时钟，无需启动外部网络与数据库，毫秒级验证逻辑；智能体生成代码后可自主执行测试并依据报错闭环自愈。
- **零依赖单文件交付**：支持将工具包编译为无任何外部依赖的单文件独立二进制产物，脱离环境泥潭，目标机器无需安装 Node.js 或 Bun 即可直接运行。
- **一次编写，全模态复用**：同一份动作源代码无缝运行于本地命令行、MCP 协议服务、远程 HTTP 微服务与智能体技能包。
- **代码与元数据契约一致**：静态声明式清单作为单一事实源，零副作用提取元数据，在编译期实现依赖闭包裁剪与按需打包。
- **纯文本资产与工作流融合**：动作与规程均为纯文本文件，天然适配代码评审、分支协作与持续集成流水线。

---

## 运行环境与依赖说明

ActionDock 2.0 针对生产环境与开发者工作流进行了架构升级：

- **日常运行与开发环境**：原生运行于 Node.js 22.13.0 或更高版本。日常的工具开发、单测执行、本地命令行交互、MCP 协议通信以及 HTTP 微服务部署完全依托 Node.js 环境，全面支持 npm、pnpm 与 yarn 包管理器，日常运行完全脱离 Bun。
- **独立二进制产物编译**：当且仅当执行 `ad build` 将项目编译为零外部依赖的单文件独立二进制产物时，系统需要安装外部 Bun 编译器，由构建模块调度其编译器管线完成可执行文件的打包。

---

## 声明式元数据事实源规范

ActionDock 2.0 引入 `actiondock.manifest.json` 规范，作为整个包内 Action 工具元数据的单一事实源：

```json
{
  "schemaVersion": 1,
  "actions": {
    "sample.greet": {
      "entry": "actions/greet.ts",
      "description": "问候用户示例工具",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "被问候者的姓名" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "count": { "type": "number" }
        },
        "required": ["message", "count"]
      },
      "uses": [],
      "tags": ["sample"]
    }
  },
  "assets": []
}
```

- **零副作用分析**：静态构建与元数据发现无需动态加载或执行任何 TypeScript 业务代码，避免代码预加载引发的副作用或性能损耗。
- **闭包计算与按需打包**：构建规划器基于清单精确分析 Action 与 Playbook 的静态依赖闭包，实现依赖剪枝与最小化分发打包。
- **统一事实源**：CLI 提示、MCP 协议暴露与文档生成统一读取该清单，保证所有交付通道契约严格一致。

---

## 快速开始

### 智能体极速接入

ActionDock 是专为 AI 智能体设计的工具底座。支持通过智能体技能包管理器直接安装与发现：

```bash
# 全局安装 ActionDock 官方技能
npx skills add team4u/actiondock -g -y

# 或安装 GitHub 上任意开源仓库的技能
npx skills add <owner/repo> -g -y
```

安装完成后，智能体可自动感知技能包内的操作规程，并调用底层原子 Action 完成复杂任务。

### 开发者标准工作流

采用主流 Node.js 与 npm 生态标准工作流：

- 全局安装命令行工具：
```bash
npm install -g @actiondock/cli
```

- 初始化项目脚手架：
```bash
ad init hello-tools
cd hello-tools
npm install
```

- 运行测试：
```bash
npm test
```

- 本地执行 Action：
```bash
ad run sample.greet --input '{"name":"ActionDock"}'
```

- 作为 MCP 服务启动：
```bash
ad mcp
```

- 导出为便携式 Agent Skill：
```bash
ad export skill
```

- 编译为独立二进制产物（需要系统安装外部 Bun 编译器）：
```bash
ad build
```

---

## 编写 Action 与 Playbook

在代码大部分由智能体生成的研发范式下，人与智能体形成了全新的分工默契：

- 人负责编写操作规程（Playbook），沉淀领域专家的作业流程、判断分支与不可逾越的安全红线。
- 智能体负责依据契约编写确定性的原子能力（Action），并通过单元测试完成自愈闭环。

```text
Playbook = 人制定规程（流程时序、安全红线、分支逻辑）
Action   = 智能体写实现（强类型、确定性原子能力）

             ↓ 结合导出

         Agent Skill 智能体技能包
```

### 定义原子 Action

在 `actions/greet.ts` 中定义具备完整类型校验与状态管理的能力：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "向指定用户问候并记录累计交互次数",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "被问候者的名字" },
    },
    required: ["name"],
  },

  async run(input, ctx) {
    const prefix = ctx.config.get("GREETING_PREFIX", "Hello");
    const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
    await ctx.state.set(`greet:${input.name}`, count);
    ctx.log.info(`用户 ${input.name} 已问候 ${count} 次`);

    return {
      message: `${prefix}, ${input.name}!`,
      count,
    };
  },
});
```

### 编写操作规程 Playbook

在 `playbooks/greet-user.md` 中编写面向智能体的标准化操作规程与红线要求：

```markdown
---
id: greet-user
description: 用户问候标准操作规程
actions:
  - sample.greet
---

# 用户问候标准操作规程

当需要向新进入会话的用户致意时，按以下要求执行：

- 确认用户姓名，不得使用未经核实的昵称。
- 调度 `sample.greet` 动作执行问候并获取历史计数。
- 若计数大于 1，在回答中体现老用户身份关怀。
```

---

## 方案与竞品对比

| 功能与评估维度 | ActionDock | mcp-use | FastMCP | Arcade MCP |
| :--- | :---: | :---: | :---: | :---: |
| 零依赖单文件独立二进制产物 | 支持 | — | — | — |
| 纯内存沙箱与确定性测试自愈 | 支持 | 支持 | 支持 | 支持 |
| 操作规程与安全红线解耦（Playbook） | 支持 | — | — | — |
| 自包含 Agent Skill 规范导出 | 支持 | — | — | — |
| 声明式清单事实源与静态依赖剪枝 | 支持 | — | — | — |
| 全模态交付（命令行、MCP、HTTP、技能包） | 支持 | 部分 | 部分 | 部分 |
| MCP 协议原生支持（STDIO 与 HTTP） | 支持 | 支持 | 支持 | 支持 |
| 远程 HTTP 微服务调度 | 支持 | 支持 | 支持 | 支持 |
| Git 原生纯文本资产架构 | 支持 | 支持 | 支持 | 支持 |

---

## 架构体系与分层设计

ActionDock 2.0 采用 8 个职责专注的子包分层架构：

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│          Node.js 命令行门面、独立分发器与信封输出渲染器           │
└──────────────┬──────────────┬───────────────┬───────────────┘
               │              │               │
               ▼              ▼               ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│     @actiondock/mcp         ││    @actiondock/builder       │
│   MCP 协议与异步任务适配器    ││  依赖闭包计算、编译器与技能导出 │
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/core                       │
│         领域模型、执行器状态机、清单与可插拔驱动契约           │
└───────┬─────────────────────────────┬───────────────┬───────┘
        │                             │               │
        ▼                             ▼               ▼
┌──────────────┐               ┌─────────────┐┌──────────────┐
│ runtime-node │               │   testing   ││     sdk      │
│Node 原生适配器│               │沙箱与模拟时钟││极简核心开发者契约│
└──────────────┘               └─────────────┘└──────────────┘
```

- `@actiondock/cli`：命令行工具链与独立运行分发器，基于 Node.js 22.13.0 或更高版本运行，提供全量命令分发、标准化信封渲染、项目初始化、运行、测试与构建导出。
- `@actiondock/builder`：构建规划与编译器调度包，包含 `BuildPlanner` 依赖闭包计算、`BunCompiler` 外部编译器调用与 `SkillExporter` 技能打包。
- `@actiondock/mcp`：MCP 协议适配器，提供 STDIO 与 HTTP 双协议通道，并完整支持 Tasks 异步任务映射。
- `@actiondock/core`：公共领域内核，提供项目配置加载、`actiondock.manifest.json` 清单管理、`SqliteDriver` 抽象、`ProcessExecutor` 抽象、`DefaultExecutionService` 与 `ActionRunner` 状态机。
- `@actiondock/runtime-node`：Node.js 运行时适配器，提供基于 `node:sqlite` 的数据库驱动、`execa` 进程执行器、`tsx` 模块加载器与基于 `node:http` 的服务监听。
- `@actiondock/testing`：独立测试框架包，提供 `FakeClock` 确定性时钟、`MockProcessExecutor` 进程模拟、`MemoryStorage` 内存存储以及 `createTestRuntime` 测试运行时。
- `@actiondock/sdk`：极简纯净开发者契约，零外部依赖，提供 `defineAction`、`ActionContext` 及核心接口类型。

---

## 验证与测试

```bash
# 执行全量单元测试与集成测试（173 项测试全部通过）
bun test

# 执行全量 TypeScript 类型检查
bun run typecheck
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
