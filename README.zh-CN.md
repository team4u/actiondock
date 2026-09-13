# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官网文档](https://team4u.github.io/actiondock/) | [English](README.md) | 简体中文

Agent 工具的工程化交付链。

把 Agent 写出来的工具代码，变成可测试、可约束、可复现、可交付的生产级软件资产。

一次编写，多形态交付。无需为不同宿主平台重复编写适配胶水代码，同一份业务能力无缝交付为 MCP 协议服务、Agent 技能包、HTTP 微服务或本地命令行工具。

```text
greet.ts (强类型 Action 实现)
       │
       ├── ad test         --> [PASS] 毫秒级纯内存沙箱单测与虚拟时钟
       ├── ad mcp          --> [READY] 导出标准 MCP 协议通信服务
       ├── ad export skill --> [EXPORT] 打包自包含 Agent 技能包（含规程与锁定依赖）
       ├── ad serve        --> [READY] 启动生产级 RESTful 微服务
       └── ad run          --> [OUTPUT] 本地命令行即时调用验证
```

> 同一份代码。一次测试。多形态交付。

---

## 痛点剖析与设计哲学

在 Agent 编写代码日益普及的当下，生成一段功能函数只需数秒，但如何将这些代码可靠地接入生产系统？

很多开发者会问：既然已经有官方 MCP 协议库或 FastMCP，也可以手写技能描述，为什么还需要专门的交付链？

- FastMCP 侧重于简化单个协议服务的编写。
- ActionDock 致力于让团队放心把 Agent 生成的工具代码投入生产环境运行。

单纯暴露裸函数或临时脚本存在明显的生产隐患：环境依赖容易漂移断裂、缺乏确定性的本地测试与状态沙箱、缺少人类业务安全规程导致的模型越权调用。

ActionDock 践行**人定规程，Agent 写实现**的核心协作范式：

- 业务规程与原子实现解耦：人类在纯文本 Playbook 中划定业务流程与安全红线；Agent 根据强类型契约编写确定性的原子 Action。
- 纯内存沙箱与测试自愈：提供毫秒级虚拟时钟与内存沙箱测试环境，支持 Agent 自主运行测试并完成故障自愈闭环。
- 生产级依赖复现与事务回滚：通过依赖锁定清单与原子事务机制，杜绝依赖漂移，支持构建自包含交付产物。
- 一次编写，多形态交付：单一代码事实源，按需分发为命令行工具、MCP 服务、HTTP 微服务与便携技能包。

---

## 运行环境与依赖说明

ActionDock 2.0 原生构建于 Node.js >=24.12.0 运行底座：

- 原生运行时能力：全面采用 Node.js 原生类型擦除、内置 SQLite 与原生 HTTP 服务，日常开发、测试、调试与运行完全脱离外部转译工具与笨重依赖。
- 标准 npm 工作流：全面对齐主流生态工作流，支持标准测试驱动开发与包分发。

---

## 快速开始

### 智能体极速接入

兼容智能体客户端可直接使用技能包管理器一键安装技能：

```bash
# 全局安装 ActionDock 官方技能
npx skills add team4u/actiondock -g -y

# 或安装开源仓库的指定技能
npx skills add <owner/repo> -g -y
```

安装完成后，兼容智能体可感知技能包内的操作规程，并调用底层原子动作完成复杂任务。

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

- 运行测试套件：
```bash
npm test
```

- 本地执行 Action：
```bash
ad run sample.greet --input '{"name":"ActionDock"}'
```

- 启动为 MCP 协议服务：
```bash
ad mcp
```

---

## 编写 Action 与 Playbook

在智能体驱动的研发模式下，人类与智能体建立了清晰的分工边界：

- 人类编写操作规程 Playbook，明确业务工作流、决策分支与严格的安全红线。
- 智能体根据类型契约编写确定性的 Action 动作，并通过自动化单元测试完成自愈闭环。

```text
Playbook = 人类定义的标准作业规程（工作流时序、分支判定、安全红线）
Action   = 智能体实现的确定性代码（强类型契约、原子能力实现）

             ↓ 统一导出

          Agent Skill 便携技能包
```

### 定义原子 Action

在 `actions/greet.ts` 中定义具备强类型契约与状态存储的 Action：

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
  ctx.log.info(`User ${input.name} has been greeted ${count} times`);

  return {
    message: `${prefix}, ${input.name}!`,
    count,
  };
});
```

### 编写操作规程 Playbook

在 `playbooks/greet-user.md` 中编写纯 Markdown 格式的标准作业规程：

```markdown
# 用户问候标准作业规程

当会话中有新用户进入时，执行以下规程步骤：

- 验证用户真实姓名，严禁使用未经核实的昵称。
- 调用 sample.greet 执行问候并获取历史问候频次。
- 若计数大于 1，在回答中体现老用户关怀。
```

在 `actiondock.json` 中显式登记规程元数据及其关联动作：

```json
{
  "playbooks": {
    "greet-user": {
      "entry": "playbooks/greet-user.md",
      "description": "用户问候标准作业规程",
      "actions": [
        "sample.greet"
      ]
    }
  }
}
```

---

## 为什么选择 ActionDock？

```text
One Action Package
├─ typed Actions
├─ human-readable Playbooks
├─ deterministic tests
├─ reproducible dependencies
└─ multiple delivery targets
   ├─ CLI
   ├─ MCP
   ├─ HTTP
   ├─ Agent Skill
   └─ standalone Node.js
```

- 业务规程与安全红线解耦：将调用时序与安全边界剥离于代码之外，以纯文本 Playbook 交付人类审查与专家管控。
- 原生纯内存沙箱：毫秒级确定性时钟与沙箱运行时，脱离外部数据库与网络依赖快速验证逻辑。
- 一次开发，多形态交付：一次编写，按需分发为命令行工具、MCP 服务、HTTP 微服务、智能体技能包或独立 Node.js 产物。
- 依赖可重现与事务保护：基于锁文件锁定依赖，支持安装与卸载操作的事务快照与回滚机制。

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

详细子包职责与分层设计请参见 [底层架构](docs/architecture/runtime.md) 文档。

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

请访问 [在线官方文档](https://team4u.github.io/actiondock/) 或查阅核心指引：

- [快速入门](docs/getting-started/overview.md)
- [开发者指南](docs/developer/first-action.md)
- [消费接入指南](docs/consumer/overview.md)
- [参考手册](docs/reference/action-api.md)
- [底层架构](docs/architecture/runtime.md)
- [贡献指南](docs/developer/contributing.md)

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
