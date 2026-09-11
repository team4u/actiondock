# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官网文档](https://team4u.github.io/actiondock/) | [English](README.md) | 简体中文

一次编写，全模态交付。

面向 AI 智能体工具与技能的 TypeScript 研发工具链，支持将工具交付为 MCP 服务、Agent Skill、HTTP 微服务或 Node.js 目录交付产物。

```text
TypeScript Action
       │
       ├── ad run          # 本地 CLI 执行
       ├── ad test         # 毫秒级沙箱单测
       ├── ad mcp          # STDIO / HTTP MCP 服务
       ├── ad serve        # 远程 HTTP 微服务
       ├── ad export skill # 自包含 Agent Skill 技能包（--mode source 或 --mode node）
       ├── ad pack         # 标准 npm tarball 打包（.tgz）
       └── ad build        # Node.js 目录交付产物构建
              ↓
           运行产物
```

---

## 核心设计理念

在代码大部分由智能体编写的今天，工具研发的瓶颈早已不是写几行胶水代码，而是工程的确定性、质量自愈与免运维交付。

随手手写的临时脚本往往缺乏契约、无法自测，运行起来容易因为环境配置缺失或版本冲突而中断；普通封装库往往只负责把函数暴露给模型，缺乏业务规程约束，极易导致模型产生幻觉或引发非预期的破坏性操作。

ActionDock 将智能体工具确立为工业级标准化软件资产：

- 人定规程，智能体写实现：人负责在操作规程 Playbook 中划定业务边界、调用时序与安全红线；智能体根据契约编写具体的原子动作实现。
- 纯内存沙箱与自愈闭环：基于纯内存沙箱测试环境与确定性时钟，无需启动外部网络与数据库，毫秒级验证逻辑；智能体生成代码后可自主执行测试并依据报错闭环自愈。
- 标准 Node 目录交付产物：支持将工具包构建为自包含可运行的 Node.js 目录交付产物，锁定生产依赖，或打包为标准 npm 压缩包。
- 一次编写，全模态复用：同一份动作源代码无缝运行于本地命令行、MCP 协议服务、远程 HTTP 微服务与智能体技能包。
- 依赖锁定与原子事务：基于 actiondock.lock.json 锁定依赖，ad add 与 ad remove 命令具备原子事务快照保护与自动回滚机制。
- 纯文本资产与工作流融合：动作与规程均为纯文本文件，天然适配代码评审、分支协作与持续集成流水线。

---

## 运行环境与依赖说明

ActionDock 2.0 针对生产环境与开发者工作流进行了原生架构升级：

- 原生 Node 24 运行环境：原生运行于 Node.js >=24.12.0。日常的工具开发、单测执行、本地命令行交互、MCP 协议通信以及 HTTP 微服务部署完全依托 Node.js 环境，基于原生类型擦除、内置 SQLite 与原生 HTTP，日常运行完全脱离外部编译器。
- 标准 npm 工作流：日常开发、测试、构建与发布使用标准 npm 工作流（npm test、npm run typecheck、npm run build、npm run test:pack）。

---

## 依赖管理与锁定规范

ActionDock 2.0 引入 [actiondock.lock.json](packages/core/src/project/lockfile.ts)（规范版本 lockfileVersion: 1），作为工具依赖锁定的事实源：

- 原子事务保障：执行 `ad add` 与 `ad remove` 时，系统自动备份 package.json、actiondock.json 与 actiondock.lock.json 快照。若安装或校验流程失败，自动执行原子回滚恢复。
- 架构彻底简化：已废弃旧版清单机制与单文件独立二进制编译器，统一采用标准 Node.js 目录交付格式与 npm 打包体系。

---

## 快速开始

### 智能体极速接入

ActionDock 是专为 AI 智能体设计的工具底座。支持通过智能体技能包管理器直接安装与发现：

```bash
# 全局安装 ActionDock 官方技能
npx skills add team4u/actiondock -g -y

# 或安装 GitHub 上开源仓库的技能
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

- 安装并锁定依赖：
```bash
ad add @actiondock/example-tools
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
# 导出源码模式技能
ad export skill

# 导出自包含 Node.js 目录模式技能
ad export skill --mode node
```

- 构建 Node.js 目录交付产物：
```bash
ad build
```

- 打包为标准 npm 压缩包：
```bash
ad pack
```

---

## 编写 Action 与 Playbook

在代码大部分由智能体生成的研发范式下，人与智能体形成了全新的分工默契：

- 人负责编写操作规程 Playbook，沉淀领域专家的作业流程、判断分支与不可逾越的安全红线。
- 智能体负责依据契约编写确定性的原子能力 Action，并通过单元测试完成自愈闭环。

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

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
  count: number;
}

export default defineAction(async (input: GreetInput, ctx): Promise<GreetOutput> => {
  const prefix = ctx.config.get("GREETING_PREFIX", "Hello");
  const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
  await ctx.state.set(`greet:${input.name}`, count);
  ctx.log.info(`用户 ${input.name} 已问候 ${count} 次`);

  return {
    message: `${prefix}, ${input.name}!`,
    count,
  };
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
| 自包含 Node 目录交付产物构建 | 支持 | — | — | — |
| 纯内存沙箱与确定性测试自愈 | 支持 | 支持 | 支持 | 支持 |
| 操作规程与安全红线解耦 Playbook | 支持 | — | — | — |
| 自包含 Agent Skill 规范导出 | 支持 | — | — | — |
| 依赖锁定与原子事务管理 | 支持 | — | — | — |
| 全模态交付（命令行、MCP、HTTP、技能包） | 支持 | 部分 | 部分 | 部分 |
| MCP 协议原生支持（STDIO 与 HTTP） | 支持 | 支持 | 支持 | 支持 |
| 远程 HTTP 微服务调度 | 支持 | 支持 | 支持 | 支持 |
| Git 原生纯文本资产架构 | 支持 | 支持 | 支持 | 支持 |

---

## 架构体系与分层设计

ActionDock 2.0 采用 7 个职责专注的子包分层架构：

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│          Node.js 命令行门面、分发器与信封输出渲染器           │
└──────────────┬──────────────┬───────────────┬───────────────┘
               │              │               │
               ▼              ▼               ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│     @actiondock/mcp         ││    @actiondock/builder       │
│   MCP 协议与异步任务适配器    ││  Node 构建、npm 打包与技能导出 │
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/core                       │
│       领域模型、执行器状态机、目录锁与统一调用门面契约         │
└───────┬─────────────────────────────┬───────────────┬───────┘
        │                             │               │
        ▼                             ▼               ▼
┌──────────────┐               ┌─────────────┐┌──────────────┐
│ runtime-node │               │   testing   ││     sdk      │
│Worker SQLite │               │沙箱与模拟时钟││极简核心开发者契约│
│与 Node 24 ESM│               │与测试运行时  ││              │
└──────────────┘               └─────────────┘└──────────────┘
```

- [@actiondock/cli](packages/cli/README.md)：命令行工具链与运行分发器，基于 Node.js >=24.12.0 运行，提供全量命令分发、标准化信封渲染、项目初始化、运行、测试、依赖管理与构建导出。
- [@actiondock/builder](packages/builder/README.md)：构建规划与交付包，提供 Node.js 目录交付产物构建（`ad build`）、npm 打包（`ad pack`）与 Agent Skill 导出（`ad export skill` 支持 `--mode source` 与 `--mode node`）。
- [@actiondock/mcp](packages/mcp/README.md)：MCP 协议适配器，提供 STDIO 与 HTTP 双协议通道，并完整支持 Tasks 异步任务映射与取消信号链路。
- [@actiondock/core](packages/core/README.md)：公共领域内核，提供项目配置加载、统一调用门面 [ActionDockTarget](packages/core/src/target/types.ts)、数据目录排他锁 [DataDirLock](packages/core/src/storage/data-dir-lock.ts)、依赖原子事务 [beginTransaction](packages/core/src/project/transactions.ts) 以及执行状态机。
- [@actiondock/runtime-node](packages/runtime-node/README.md)：Node.js 运行时适配器，提供基于 node:sqlite 的默认同步存储驱动（另有独立异步驱动 WorkerSqliteDriver 可选）、原生类型擦除模块加载器与基于 `node:http` 的服务监听。
- [@actiondock/testing](packages/testing/README.md)：独立测试框架包，全面收敛 [FakeClock](packages/testing/src/clock.ts) 确定性时钟、[MockProcessExecutor](packages/testing/src/process.ts) 进程模拟、[MemoryStorage](packages/testing/src/storage.ts) 内存存储以及 [createTestRuntime](packages/testing/src/runtime.ts) 测试运行时。
- [@actiondock/sdk](packages/sdk/README.md)：极简纯净开发者契约，零生产依赖，仅提供 `defineAction`、`ActionContext`、`Config`、`StateStore`、`ActionInvoker`、`Logger` 与 `ProcessAPI`。

---

## 验证与测试

```bash
# 执行全量单元测试与集成测试
npm test

# 执行全量 TypeScript 类型检查
npm run typecheck

# 执行多包产物全量构建
npm run build

# 执行发布打包冒烟测试
npm run test:pack
```

---

## 技术文档中心

更详细的架构解析、开发教程与参考手册请查阅 [在线官方文档](https://team4u.github.io/actiondock/) 或本地文档目录：

- 快速概览：
  - [环境安装与准备](docs/getting-started/installation.md)：Node.js 运行底座、命令行全局安装与开发工作流。
  - [核心概览与双轨导引](docs/getting-started/overview.md)：系统架构总览、子包分层体系与角色路径选择。
- 使用者指南：
  - [消费与接入总览](docs/consumer/overview.md)：工程依赖消费、智能体技能装载与接入选型。
  - [Agent Skill 使用指南](docs/consumer/use-as-skill.md)：通过 npx skills 一键安装、装载路径与规程调用。
  - [开发工具 MCP 接入](docs/consumer/use-as-mcp.md)：STDIO 服务直连 Cursor 与 Windsurf。
  - [Node 交付产物运行](docs/consumer/standalone-run.md)：自包含 Node.js 目录交付产物运行与离线依赖。
  - [HTTP 微服务与 API 调度](docs/consumer/http-service.md)：微服务启动与 REST API 远程调度。
  - [消费端配置与凭证注入](docs/consumer/configuration.md)：API 令牌、环境变量与持久化配置注入。
- 开发者指南：
  - [快速上手开发](docs/developer/quick-start.md)：工程初始化、编写 Action 与本地调试。
  - [深入业务 Action 开发](docs/developer/first-action.md)：强类型模式、状态持久化与外部 API 调用。
  - [编写 Playbook 规程](docs/developer/playbooks.md)：领域专家标准作业规程编排与安全红线。
  - [单元测试与沙箱验证](docs/developer/testing.md)：纯内存毫秒级单元测试与确定性时钟。
  - [状态持久化与 SQLite 存储](docs/developer/storage.md)：内嵌 SQLite 数据模型、KV 存储与过期策略。
  - [多环境 Profile 与远程调度](docs/developer/profiles.md)：多云环境节点管理与凭证保护。
  - [构建打包与 Skill 导出](docs/developer/build-and-export.md)：目录交付产物构建、npm 打包与技能资产导出。
- 核心概念：
  - [Action Package 核心抽象](docs/concepts/action-package.md)：包能力、操作规程、接口契约与运行态。
  - [Action 原子能力契约](docs/concepts/action.md)：动作定义函数与模式即契约设计哲学。
  - [ActionContext 运行时上下文](docs/concepts/action-context.md)：配置解析回退、持久化状态、级联调用与取消链路。
  - [Playbook 规程模型](docs/concepts/playbook.md)：面向智能体的标准作业规程与安全边界。
  - [Agent Skill 技能资产规范](docs/concepts/skill.md)：源码型与 Node 目录型双模导出交付规范。
- 参考手册与底层架构：
  - [CLI 命令行速查](docs/reference/cli.md)：全量 ad 命令、选项标志与退出码规范。
  - [配置解析回退机制](docs/reference/config.md)：配置多级回退链与环境变量解析。
  - [Action SDK API 参考](docs/reference/action-api.md)：公共 SDK 核心导出函数与接口契约。
  - [错误代码速查手册](docs/reference/error-codes.md)：标准 JSON 错误信封与自愈决策表。
  - [版本迁移参考指南](docs/reference/v1-to-v2-migration.md)：旧版架构升级对比与平滑演进步骤。
  - [Runtime 执行引擎架构](docs/architecture/runtime.md)：单一终态状态机与并发管控。
  - [输出通道物理隔离设计](docs/architecture/stdout-stderr.md)：数据信封与诊断日志物理隔离。
  - [安全加固与防御模型](docs/architecture/security.md)：非回环鉴权、常数时间比对与原型污染防护。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
