# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官网文档](https://team4u.github.io/actiondock/) | [English](README.md) | 简体中文

写一次 Action，同时交付 CLI、MCP、HTTP 和 Agent Skill。

内置测试沙箱、状态存储、配置体系、运行追踪与可复现打包。

```text
$ npm install -g @actiondock/cli
$ ad init hello && cd hello
[OK] Initialized ActionDock project in hello

$ ad action create greet --input name:string --output message:string
[OK] Created action greet (actions/greet.ts)
[OK] Generated contract types (.actiondock/generated/actions.d.ts)

$ ad test
[PASS] tests/greet.test.ts (1.2ms, in-memory sandbox)
1 passed, 0 failed

$ ad run greet --input '{"name":"World"}'
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2",
  "data": { "message": "Hello, World!" }
}

$ ad mcp          --> [READY] Model Context Protocol (STDIO/SSE)
$ ad serve        --> [READY] RESTful HTTP Microservice (:8080)
$ ad export skill --> [EXPORT] Self-contained Agent Skill bundle
```

---

## 5 分钟极简上手

无需手写复杂 JSON Schema，仅需 5 个核心命令即可完成从脚手架初始化到多目标交付全流程：

- 全局安装命令行工具：
  ```bash
  npm install -g @actiondock/cli
  ```

- 初始化项目骨架：
  ```bash
  ad init hello
  cd hello
  ```

- 声明并创建 Action：
  命令行自动解析字段类型、生成强类型契约并更新清单：
  ```bash
  ad action create greet --input name:string --output message:string
  ```

- 编写业务逻辑：
  在 `actions/greet.ts` 中直接消费生成的强类型定义，聚焦纯粹业务实现：
  ```ts
  import { defineAction } from "@actiondock/sdk";
  import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

  export type Input = ActionInput<"greet">;
  export type Output = ActionOutput<"greet">;

  export default defineAction<Input, Output>(async (input, ctx) => {
    ctx.log.info("Greeting user", input);
    return {
      message: `Hello, ${input.name}!`,
    };
  });
  ```

- 纯内存测试与本地运行：
  在毫秒级沙箱中运行单测，并通过本地命令行即时验证执行结果：
  ```bash
  # 运行纯内存沙箱测试
  ad test

  # 本地命令行调用验证
  ad run greet --input '{"name":"World"}'
  ```

- 多形态即刻交付：
  同一份 Action 代码无需修改，即可一键交付为多种目标形态：
  ```bash
  # 启动标准 MCP 协议通信服务（供 Cursor、Windsurf 或 Claude Desktop 挂载）
  ad mcp

  # 启动生产级 RESTful HTTP/HTTPS 微服务（支持 --https 零配置自签名证书或生产机构证书）
  ad serve

  # 导出自包含 Agent 技能包（供智能体自主检索规程与调用动作）
  ad export skill
  ```

---

## 为什么选择 ActionDock

在代码生成日益自动化的环境下，工具研发的核心挑战在于确定性、安全防线与低维护交付：

- 比直接手写裸脚本更可靠：裸脚本容易因外部环境缺失或依赖漂移而发生脆断，ActionDock 提供确定性测试沙箱与自愈校验机制。
- 比裸露接口更安全：纯函数接口直接暴露给大模型极易引发时序混乱甚至越权操作，ActionDock 采用人定规程划定业务边界与安全底线。
- 比手写协议胶水更高效：传统方案需要针对本地命令行、MCP 协议与 HTTP 微服务分别编写封装层，ActionDock 以 Action 为唯一原子，实现一次编写多形态交付。

---

## 进阶特性与架构机制

### 契约模型与清单驱动

底层以 `actiondock.json` 作为项目元数据与能力清单的唯一事实源。开发者通过 `ad action create` 自动维护清单，亦可按需手工精细化配置：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "hello",
  "name": "Hello Tools",
  "version": "0.1.0",
  "actions": {
    "greet": {
      "entry": "actions/greet.ts",
      "description": "Greeting action",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"]
      }
    }
  }
}
```

修改清单后，可通过以下命令重新同步生成 TypeScript 契约定义：

```bash
ad generate types
```

### 人定规程与安全红线

ActionDock 践行人定规程与智能体自主实现的协作分工：

- 人类编写操作规程 Playbook：在纯 Markdown 规程中沉淀业务步骤、前置条件与不可逾越的安全红线。
- 智能体编写原子 Action：按照强类型契约实现具体功能，并通过沙箱测试完成自主验证。

```text
Playbook = 人类定义的业务规程（工作流时序、分支判定、安全红线）
Action   = 智能体实现的原子代码（强类型契约、纯粹业务能力）

             ↓ 统一交付

          Agent Skill 便携技能包 / MCP 协议服务 / HTTP 微服务
```

### 状态持久化与上下文机制

通过 `ActionContext` 访问核心运行期能力，全面保持环境隔离与安全性：

- 状态持久化：通过 `ctx.state` 访问嵌入式存储，实现轻量状态存取。
- 配置体系：通过 `ctx.config` 获取环境变量与默认配置，支持多级回退策略。
- 通道隔离：通过 `ctx.log` 记录运行期日志，过程日志自动分流至标准错误流，保障标准输出报文纯净。
- 运行追踪：每次执行均分配唯一运行标识，支持全链路状态审计与取消中断。

### 现代原生运行底座

ActionDock 原生运行于 Node.js 版本大于等于 24.12.0 底座，充分释放原生工程红利：

- 原生类型擦除：直接执行 TypeScript 代码，无需 Babel、esbuild 等转译步骤。
- 原生轻量存储：依托内置模块 `node:sqlite` 提供嵌入式存储支持，无需编译本地原生数据库驱动。
- 原生网络服务：依托内置模块 `node:http` 原生承载微服务，杜绝外部重型 Web 框架开销。
- 极简依赖拓扑：消除冗余构建层，保证全流程纯粹轻快。

---

## 体系架构与子包划分

ActionDock 采用高内聚、松耦合的子包分层架构：

```text
┌─────────────────────────────────────────────────────────────┐
│                      @actiondock/cli                        │
│          Node.js 命令行门面、分发器与信封输出渲染器           │
│    ad init / ad action create / ad test / ad run / ad mcp   │
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

---

## 常见疑问解答

- ActionDock 是什么？
  ActionDock 是面向智能体动作与技能的工程化开发、测试、构建与分发工具链。它以 Action 为唯一核心原子，帮助开发者将松散的代码片段转化为结构完备、具备生产保障的工业级软件资产。

- 比直接手写 MCP 好在哪里？
  手写 MCP 协议代码缺乏本地测试沙箱、易受外部依赖漂移影响，且缺乏规程约束容易导致越权。ActionDock 作为上游工程化底座，不仅提供测试沙箱与依赖保障，还能一键分发为 MCP、HTTP 微服务、Agent Skill 或本地命令行，业务代码零重复。

- 是否必须手写 JSON Schema？
  完全不需要。通过 `ad action create` 命令行即可一键生成字段模式并自动更新契约，无需手动编写复杂的模式结构。

---

## 底层构建与项目维护

面向框架开发者与深度集成场景的底层工程维护命令：

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

请访问 [在线官方文档](https://team4u.github.io/actiondock/) 或查阅核心指引：

- [系统概览与核心概念](docs/getting-started/overview.md)
- [快速上手指南](docs/getting-started/quick-start.md)
- [Action 核心模型与开发指南](docs/developer/first-action.md)
- [消费接入选型总览](docs/consumer/overview.md)
- [参考手册](docs/reference/action-api.md)
- [底层架构解密](docs/architecture/runtime.md)
- [贡献指南](docs/developer/contributing.md)

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
