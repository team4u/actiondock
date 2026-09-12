# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官网文档](https://team4u.github.io/actiondock/) | [English](README.md) | 简体中文

一次编写，全模态交付。

面向智能体动作与技能的工业级开发、测试、构建与分发工具链。支持将原子能力无缝交付为 MCP 协议服务、智能体技能包、HTTP 微服务或自包含 Node.js 目录交付产物。

```text
TypeScript 动作源码
       │
       ├── ad run          # 本地命令行执行
       ├── ad test         # 毫秒级内存沙箱单测
       ├── ad mcp          # STDIO 与 HTTP 协议通信服务
       ├── ad serve        # 生产级 HTTP 微服务
       ├── ad export skill # 自包含智能体技能包（源码型与目录型）
       ├── ad pack         # 标准 npm 压缩包打包
       └── ad build        # 自包含 Node.js 运行时目录构建
              ↓
           运行产物
```

---

## 核心设计理念

在代码大部分由智能体编写的今天，工具研发的瓶颈早已不是编写胶水代码，而是工程的确定性、质量自愈与免运维交付。

随手编写的脚本往往缺乏契约、无法自测，极易因为运行环境配置缺失或依赖冲突而中断；普通的接口封装库往往只负责把函数暴露给模型，缺乏业务规程约束，极易导致模型产生幻觉或引发破坏性操作。

ActionDock 将智能体工具确立为工业级标准化软件资产：

- 人定规程，智能体写实现：人类专家在操作规程 Playbook 中划定业务边界、调用时序与安全红线；智能体根据强类型契约编写具体的原子动作实现。
- 纯内存沙箱与自愈闭环：基于纯内存沙箱测试环境与确定性时钟，无需启动外部网络与数据库，毫秒级验证逻辑；智能体生成代码后可自主执行测试并依据报错闭环自愈。
- 标准 Node 目录交付产物：支持将工具包构建为自包含可运行的 Node.js 目录交付产物，锁定生产依赖，或打包为标准 npm 压缩包。
- 一次编写，全模态复用：同一份动作源代码无缝运行于本地命令行、MCP 协议服务、远程 HTTP 微服务与智能体技能包。
- 依赖锁定与原子事务：基于 actiondock.lock.json 锁定依赖，安装与卸载命令具备原子事务快照保护与自动回滚机制。
- 纯文本资产与工作流融合：动作与规程均为纯文本文件，天然适配代码评审、分支协作与持续集成流水线。

---

## 运行环境与依赖说明

ActionDock 2.0 原生构建于 Node.js >=24.12.0 运行底座：

- 原生运行时能力：全面采用 Node.js 原生类型擦除、内置 SQLite 与原生 HTTP 服务，日常开发、测试、调试与运行完全脱离外部转译工具与笨重依赖。
- 标准 npm 工作流：全面对齐主流生态工作流，支持标准测试驱动开发与包分发。

---

## 快速开始

### 智能体极速接入

智能体客户端可直接使用技能包管理器从代码仓库一键安装技能：

```bash
# 全局安装 ActionDock 官方技能
npx skills add team4u/actiondock -g -y

# 或安装开源仓库的指定技能
npx skills add <owner/repo> -g -y
```

安装完成后，智能体可自动感知技能包内的操作规程，并调用底层原子 Action 完成复杂任务。

### 开发者标准工作流

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

- 运行测试套件：
```bash
npm test
```

- 本地执行 Action：
```bash
ad run sample.greet --input '{"name":"ActionDock"}'
```

- 启动为 MCP 服务：
```bash
ad mcp
```

- 导出为 Agent Skill 技能包：
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

在现代智能体驱动的开发模式下，人和智能体形成明确的分工：

- 人类编写操作规程 Playbook：沉淀领域专家的作业流程、判断分支与安全红线。
- 智能体编写原子实现 Action：依据契约编写确定性的原子能力，并通过单元测试完成自愈闭环。

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
- 调度 sample.greet 动作执行问候并获取历史计数。
- 若计数大于 1，在回答中体现老用户关怀。
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

## 架构体系与子包划分

ActionDock 采用职责明确的子包分层架构：

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
│ 同步/Worker  │               │沙箱与模拟时钟││零依赖核心开发契约│
│SQLite 与 HTTP│               │与测试运行时  ││              │
└──────────────┘               └─────────────┘└──────────────┘
```

- [@actiondock/cli](packages/cli/README.md)：命令行工具链与运行分发器，提供全量子命令分发、标准化信封渲染、脚手架与构建导出。
- [@actiondock/builder](packages/builder/README.md)：构建规划与交付工具，提供目录交付构建（`ad build`）、npm 打包（`ad pack`）与 Agent Skill 导出（`ad export skill`）。
- [@actiondock/mcp](packages/mcp/README.md)：MCP 协议适配器，提供 STDIO 与 HTTP 传输通道，支持异步任务状态流转与取消信号传播。
- [@actiondock/core](packages/core/README.md)：公共领域内核，提供项目配置加载、统一调用门面、数据目录排他锁、依赖原子事务以及执行状态机。
- [@actiondock/runtime-node](packages/runtime-node/README.md)：Node.js 运行时适配器，提供同步与异步 SQLite 驱动实现、模块加载与原生 HTTP 服务。
- [@actiondock/testing](packages/testing/README.md)：确定性测试框架，提供虚拟时钟、进程模拟、内存持久化引擎与测试运行时。
- [@actiondock/sdk](packages/sdk/README.md)：极简纯净开发者契约，零生产依赖，导出 `defineAction` 与核心上下文接口。

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

- 快速入门：
  - [系统概览与心智模型](docs/getting-started/overview.md)：痛点解析、设计理念与角色双轨路径。
  - [运行环境准备与安装](docs/getting-started/installation.md)：Node.js 24 基础环境、全局命令与贡献者工作流。
  - [快速上手指南](docs/getting-started/quick-start.md)：从零构建第一个 Action 并全模态运行。
- 开发者指南：
  - [Action 核心模型与开发指南](docs/developer/first-action.md)：强类型契约、ActionContext 上下文、状态持久化与外部 API 调用。
  - [Playbook 规程编写指南](docs/developer/playbooks.md)：领域专家标准作业规程编排、委托依赖与安全红线。
  - [单元测试与沙箱验证](docs/developer/testing.md)：纯内存毫秒级单元测试与确定性时钟。
  - [状态持久化与 SQLite 存储](docs/developer/storage.md)：内嵌 SQLite 数据模型、键值存储与过期策略。
  - [构建打包与 Skill 导出规范](docs/developer/build-and-export.md)：目录交付产物构建、npm 打包与技能资产导出。
- 场景实战：
  - [高可用外部 API 接入](docs/practices/external-apis.md)：网络请求、密钥防护、指数退避重试与取消响应。
  - [受控系统命令与子进程执行](docs/practices/process-execution.md)：物理管道隔离、输出容量防御性截断与进程树跨平台清理。
  - [长时间异步任务与进度上报](docs/practices/long-running-tasks.md)：阶段进度同步与异步任务协议集成。
  - [多 Action 组合编排与防死锁](docs/practices/composing-actions.md)：级联调用深度限制与环路死锁阻断。
  - [智能体协同开发与自愈闭环](docs/practices/ai-agent-development.md)：大模型自主阅读规程、编写代码与闭环自愈指南。
- 消费接入指南：
  - [消费与接入总览](docs/consumer/overview.md)：工程依赖消费、智能体技能装载与接入选型。
  - [Agent Skill 使用指南](docs/consumer/use-as-skill.md)：通过技能管理器一键安装、智能体装载路径与规程调用。
  - [开发工具 MCP 接入](docs/consumer/use-as-mcp.md)：STDIO 服务直连 Cursor、Windsurf 与 Claude Code。
  - [Node 交付产物运行](docs/consumer/standalone-run.md)：自包含 Node.js 目录交付产物运行与离线依赖。
  - [HTTP 微服务与 API 调度](docs/consumer/http-service.md)：微服务启动与 REST API 远程调度。
  - [配置注入与多环境管理](docs/consumer/configuration.md)：API 令牌、环境变量、SQLite 持久化与多环境 Profile 调度。
- 权威参考手册：
  - [CLI 命令行速查](docs/reference/cli.md)：全量子命令、参数选项与退出码规范。
  - [actiondock.json 清单规范权威手册](docs/reference/schema.md)：项目清单全量字段、类型约束与示例。
  - [Action SDK API 参考](docs/reference/action-api.md)：公共 SDK 核心导出函数与接口契约。
  - [Testing 测试框架 API 参考](docs/reference/testing-api.md)：测试运行时、虚拟时钟与模拟组件接口参考。
  - [配置解析回退机制](docs/reference/config.md)：配置多级回退链与环境变量解析。
  - [错误代码速查手册](docs/reference/error-codes.md)：标准 JSON 错误信封与自愈决策表。
- 底层架构解密：
  - [Runtime 执行引擎与通道隔离](docs/architecture/runtime.md)：单一终态状态机、并发管控与数据信封物理隔离。
  - [安全加固与防御模型](docs/architecture/security.md)：非回环鉴权、常数时间比对与原型污染防护。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
