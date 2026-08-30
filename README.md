# ActionDock 2.0

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-66%20passed-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> 一次编写，随处运行。面向 AI Agent 的 Action 与 Skill 开发、测试、构建与分发工具链。

ActionDock 2.0 是面向 AI Agent 与研发团队的新一代工具链体系。它革新了传统 Agent 工具的开发与交付模式：采用 **源码型 Skill**与**零安装独立二进制** 双模交付，让开发者使用 TypeScript 与标准 JSON Schema 快速构建原子工具（Action），并无缝对接 Model Context Protocol (MCP)。

- **预装 ActionDock 环境** (推荐)：直接分发极轻量源码型 Skill（`SKILL.md + actiondock.json + actions`），跨平台免编译，动态加载依赖。
- **无依赖裸机环境**：一键打包为自包含、零外部依赖的独立可执行文件（`--standalone`），目标机器无需安装 Node.js、Bun、Python 或 Java 即可直接运行。

[进入官方完整文档中心](docs/README.md)

---

## 设计思考与架构哲学

- **零依赖独立交付**：借助 Bun 原生编译引擎，将 TypeScript 代码、npm 依赖闭包及运行时打包为单一独立二进制文件。分发后开箱即用，从根源杜绝环境漂移与依赖冲突。
- **文件系统优先**：Action（`actions/*.ts`）、Playbook（`playbooks/*.md`）与项目配置均为普通文件，天然契合 Git 版本控制、分支合并与代码评审流程。
- **强类型与标准契约**：统一全链路编程语言为 TypeScript，入参与出参使用标准 JSON Schema 配合 Ajv 严格校验，无自定义私有 DSL 学习负担。
- **独立编译契约原则**：在本地开发态（`ac run`）、编译后独立二进制态（`./bin/pkg run`）与 MCP Tool 态下，`ActionContext` 的上下文语义、5 级配置优先级、状态持久化与输出 JSON Envelope 保持严格一致。
- **双模交付与协议适配**：既可作为 Model Context Protocol (MCP) STDIO / HTTP 服务端供 Agent IDE 直连，亦可作为自包含 Skill 交付包跨机器分发。
- **通道分离与白盒可观测**：执行数据严格输出至 `stdout`（标准 JSON Envelope），运行日志与诊断信息强制输出至 `stderr`，确保 Agent 协议消费绝对纯净。

---

## 核心功能与能力概览

| 组件 / 能力 | 对应模块 / 命令 | 解决的典型问题 | 文档入口 |
| :--- | :--- | :--- | :--- |
| **极简公共 SDK** | `@actiondock/sdk` | `defineAction` 强类型定义、`ActionContext` 上下文、`createTestRuntime` 内存测试运行时。 | [Action 编写](docs/action-authoring.md) · [Context 详解](docs/action-context.md) |
| **核心执行引擎** | `@actiondock/core` | ActionRunner 执行器、5 级配置优先级回退、跨 Action 组合调用与循环依赖防御、超时与协作式取消。 | [架构设计](docs/design-security-mcp-execution.md) · [单测指南](docs/testing-guide.md) |
| **持久化状态存储** | `bun:sqlite` / Storage | 基于 SQLite 的 Config 配置、跨调用持久化 State（支持 TTL 与命名空间）以及 Runs 执行历史与调用链。 | [存储与状态](docs/storage-and-state.md) |
| **MCP 协议适配器** | `@actiondock/mcp` / `ac mcp` | 提供 STDIO 与 HTTP 双模 Transport，Action 与 Tool 零冗余映射，支持 MCP Tasks 异步长任务扩展。 | [MCP 指南](docs/mcp-integration.md) |
| **独立构建与编译** | `Bun.build` / `ac build` | 一键编译为单文件独立二进制，支持全平台交叉编译（Linux / macOS / Windows）与 Tree-shaking 裁剪。 | [构建与编译](docs/build-and-export.md) |
| **SOP 与 Skill 交付** | `ac export skill` / Playbooks | 编写领域 SOP 操作规程，一键导出包含 `SKILL.md` 与独立二进制的自包含 Skill 交付包。 | [Skill 规范](docs/skill-guide.md) · [Playbook 编写](docs/playbook-guide.md) |
| **多云与多环境调度** | `ac serve` / `ac profile` | 在远程主机启动轻量 HTTP Runner，本地通过 Profile 无缝调度多云主机，支持异步长任务生命周期管理。 | [多环境调度](docs/remote-and-profiles.md) |
| **CLI 门面工具** | `@actiondock/cli` (`ac`) | 极速短命令 `ac`，提供脚手架初始化、正则与模糊意图过滤、开发态缺失依赖毫秒级自动补齐。 | [CLI 参考手册](docs/cli-reference.md) |

---

## 快速接入

### 安装 CLI (`ac`)

```bash
# 全局安装（推荐，安装后可全局使用 ac 命令）
bun install -g @actiondock/cli

# 或从源码仓库注册软链接（框架贡献者）
cd packages/cli && bun link
```

### 5 分钟完整开发与交付流

#### 初始化新项目
```bash
ac init my-tools --id team.my-tools --name "My Tools" --desc "自定义 Agent Action 集合"
cd my-tools
```

#### 创建并编写 Action
使用 CLI 生成模板或直接编辑 `actions/greet.ts`：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
  count: number;
}

export default defineAction<GreetInput, GreetOutput>({
  id: "sample.greet",
  description: "向指定用户发送个性化问候语",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "被问候者的名字" },
    },
    required: ["name"],
  },

  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      count: { type: "number" },
    },
    required: ["message", "count"],
  },

  async run(input, ctx) {
    // 读取配置（5 级回退：CLI覆盖 > 项目DB > 全局DB > 环境变量 > 声明默认值）
    const greeting = ctx.config.get("GREETING", "你好");

    // 读写持久化状态（跨执行保留，支持 TTL）
    const count = ((await ctx.state.get<number>("greet_count")) || 0) + 1;
    await ctx.state.set("greet_count", count);

    // 打印结构化日志（走 stderr，不污染 stdout JSON）
    ctx.log.info(`正在问候 ${input.name}（第 ${count} 次）`);

    return {
      message: `${greeting}，${input.name}！`,
      count,
    };
  },
});
```

#### 开发态运行与调试
```bash
ac action run sample.greet --input '{"name": "张三"}'
```

输出标准 JSON Envelope（stdout）：
```json
{
  "ok": true,
  "runId": "01J...",
  "data": {
    "message": "你好，张三！",
    "count": 1
  }
}
```

#### 运行内存单元测试
```bash
ac test
```

#### 编译为独立二进制
```bash
ac build
```
编译产物位于 `dist/bin/my-tools`。目标机器**无需安装任何运行时**，直接执行：
```bash
./dist/bin/my-tools run sample.greet --input '{"name": "李四"}'
```

#### 导出 Agent Skill 交付包
```bash
# 默认导出源码型 Skill（轻量、跨平台，由 ac 运行时直接加载）
ac export skill

# 或导出独立自包含二进制 Skill（零外部依赖，内置预编译二进制）
ac export skill --standalone
```
导出的源码型 Skill 目录结构：
```text
dist/my-tools-skill/
├── SKILL.md                  # 面向 AI Agent 的主调用指南（含 YAML Frontmatter 与 ac link 指引）
├── actiondock.json          # Package 清单与运行时配置
├── package.json             # 依赖声明（@actiondock/sdk）
├── actions/                 # TypeScript Action 源码
│   └── greet.ts
└── playbooks/                # 任务 SOP 规程目录
    └── greet-user.md
```

---

## 仓库架构与包结构

ActionDock 采用清晰的正交分层 Monorepo 架构：

```text
actiondock/
├── packages/
│   ├── sdk/          # @actiondock/sdk：极简公共 SDK（defineAction, ActionContext, createTestRuntime）
│   ├── core/         # @actiondock/core：公共领域内核（Runtime, Storage, Schema, Build, Export, Standalone）
│   ├── mcp/          # @actiondock/mcp：Model Context Protocol 适配器（STDIO / HTTP / Tasks 扩展）
│   └── cli/          # @actiondock/cli：命令行门面工具链（ac）
├── examples/
│   └── github-tools/ # 官方完整示例 Action Package
├── docs/             # 官方完整技术文档中心
└── skills/           # 面向 AI Agent 的官方 Skill 规范
```

---

## 导航与参考

- **[官方文档中心](docs/README.md)**：包含各组件的架构设计、API 手册、协议规范与实战指南。
- **[快速上手指南](docs/quick-start.md)**：从环境准备到首个 Action 导出的 5 分钟教程。
- **[Action 编写指南](docs/action-authoring.md)**：强类型定义、Schema 校验、依赖管理与 Action 组合。
- **[ActionContext 核心能力详解](docs/action-context.md)**：配置回退、持久化状态、日志隔离与 AbortSignal 取消链路。
- **[Model Context Protocol 适配器](docs/mcp-integration.md)**：STDIO / HTTP 协议、Tool 映射与 MCP Tasks 扩展。
- **[CLI 命令行参考手册](docs/cli-reference.md)**：全量命令、参数选项与 JSON 协议规范。

---

## 验证与测试

```bash
# 执行全量单元与集成测试（65 个测试用例）
bun test

# 执行全量 TypeScript 类型检查
bun run typecheck
```

---

## 开源协议

本项目采用 [Apache-2.0](LICENSE) 开源协议。
