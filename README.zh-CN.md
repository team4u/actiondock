# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官方文档](https://team4u.github.io/actiondock/) | [English](README.md) | 简体中文

写一次 Action，同时交付 CLI、MCP、HTTP 和 Agent Skill。

面向 AI Agent Action 与 Skill 的工程化开发、测试、构建与分发工具链。内置纯内存测试沙箱、状态存储、配置体系、运行追踪与可复现打包。

```bash
# 全局安装并初始化项目
npm install -g @actiondock/cli
ad init hello && cd hello

# 声明并创建 Action，自动生成强类型契约
ad action create greet --input name:string --output message:string

# 运行毫秒级纯内存沙箱测试
ad test

# 本地验证执行
ad run greet -- name=World

# 一键交付多种目标形态
ad mcp          # MCP 协议通信服务（供 Cursor、Windsurf、Claude Desktop 挂载）
ad serve        # RESTful HTTP 微服务（默认端口 8080）
ad export skill # Agent 技能包（供 Claude Code、Codex、Antigravity 消费）
```

---

## 核心特性

- **契约驱动开发**：以 Action 为唯一核心原子，基于命令行自动生成强类型契约并维护能力清单，告别手动编写 JSON Schema。
- **确定性测试沙箱**：内置纯内存测试沙箱与虚拟时钟驱动，无需配置真实环境即可执行高可靠确定性测试。
- **一次编写多形态交付**：业务逻辑仅需编写一次，无缝以本地命令行、MCP 协议服务、RESTful HTTP 微服务或 Agent Skill 资产发布。
- **现代原生运行底座**：基于 Node.js 24+ 原生类型擦除、`node:sqlite` 嵌入式存储与 `node:http` 微服务引擎，零外部重型依赖。
- **人定规程与安全红线**：结合纯 Markdown 操作规程与原子 Action 执行，划定业务边界与安全红线，杜绝模型越权与时序混乱。

---

## 快速上手

- 安装工具链并初始化项目：
  ```bash
  npm install -g @actiondock/cli
  ad init hello
  cd hello
  ```

- 声明并创建 Action：
  命令行自动解析字段类型、生成强类型契约并更新清单：
  ```bash
  ad action create greet --input name:string --output message:string
  ```

- 编写业务实现：
  在 `actions/greet.ts` 中直接使用生成的类型定义，聚焦纯粹业务逻辑：
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

- 运行测试与本地验证：
  ```bash
  # 运行纯内存沙箱测试
  ad test

  # 本地规范调用
  ad run greet -- name=World
  ```

- 多形态即刻交付：
  ```bash
  # 启动标准 MCP 协议通信服务
  ad mcp

  # 启动 RESTful HTTP 微服务
  ad serve

  # 导出自包含 Agent 技能包
  ad export skill
  ```

---

## 模块架构

ActionDock 采用分层解耦的单体多包架构：

| 子包 | 描述 |
| --- | --- |
| `@actiondock/sdk` | 极简核心公共 SDK 与类型定义（`defineAction`、`ActionContext`），零外部依赖 |
| `@actiondock/core` | 原生运行时驱动、统一服务门面、标准服务端口模型与存储系统 |
| `@actiondock/cli` | 命令行工具链、分发器、参数扁平编码解析与执行门面 |
| `@actiondock/mcp` | Model Context Protocol 协议适配、工具暴露与异步取消链路 |
| `@actiondock/builder` | 依赖规划、目录型构建、npm 打包与 Agent Skill 资产导出 |
| `@actiondock/testing` | 确定性纯内存沙箱、虚拟时钟与确定性测试运行时框架 |

---

## 文档指引

更多深度功能与详细说明请访问 [在线官方文档](https://team4u.github.io/actiondock/) 或查阅本地指南：

- [系统概览与核心概念](docs/getting-started/overview.md)
- [快速上手指南](docs/getting-started/quick-start.md)
- [Action 开发指南](docs/developer/first-action.md)
- [Playbook 操作规程](docs/developer/playbooks.md)
- [消费接入选型总览](docs/consumer/overview.md)
- [CLI 规范调用参考手册](docs/reference/cli.md)
- [底层架构设计](docs/architecture/runtime.md)

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
