# ActionDock

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

[官网文档](https://team4u.github.io/actiondock/) | [English](README.md) | 简体中文

智能体工具工程化交付链。

把智能体生成的工具代码，转化为可测试、可约束、可复现、可交付的生产级软件资产。

## 一次编写，多形态交付

Action 是 ActionDock 中唯一的产品原子与核心抽象。业务规程 Playbook、便携技能包 Agent Skill、协议通信 MCP 服务以及生产级 HTTP 微服务，皆是围绕 Action 的能力增强与交付形态。

### 10 行代码定义原子 Action

在 `actions/greet.ts` 中编写业务逻辑，直接消费自动生成的强类型契约与上下文能力：

```ts
import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

export default defineAction<ActionInput<"greet">, ActionOutput<"greet">>(
  async (input, ctx) => {
    ctx.log.info("Greeting user", input);
    return {
      message: `Hello, ${input.name}!`,
    };
  }
);
```

### 多形态即刻交付

同一份 Action 代码，无需编写任何适配胶水代码，即可通过命令行工具分发为多种形态：

```text
actions/greet.ts（强类型 Action 实现）
       │
       ├── ad test         --> [PASS] 毫秒级内存沙箱与虚拟时钟单测
       ├── ad run          --> [OUTPUT] 本地命令行即时调用验证
       ├── ad mcp          --> [READY] 导出标准 MCP 协议通信服务
       ├── ad export skill --> [EXPORT] 打包自包含 Agent 技能包（含规程与锁定依赖）
       └── ad serve        --> [READY] 启动生产级 RESTful 微服务
```

### 生产级工程保障

- 纯内存沙箱与测试自愈：提供毫秒级虚拟时钟与内存隔离测试环境，支持智能体自主运行测试套件，就地捕获异常并完成闭环自愈。
- 业务规程与原子实现解耦：人类专家在纯文本 Markdown 规程中沉淀业务时序、决策分支与安全红线；智能体专心实现强类型契约 Action，拒绝模型越权。
- 确定性依赖复现与事务回滚：基于依赖清单严格锁定版本，支持安装与卸载操作的原子事务快照与故障回滚，彻底杜绝环境漂移。
- 契约规范与平台中立：以 `actiondock.json` 为契约唯一事实源，业务逻辑与通信协议和外部环境彻底解耦。

---

## 新手常见解答

- 这是什么？
  ActionDock 是面向智能体动作与技能的工程化开发、测试、构建与分发工具链。它以 Action 为唯一核心原子，帮助开发者将松散的代码片段转化为结构完备、具备生产保障的工业级软件资产。

- 比直接写 MCP 好在哪里？
  直接手写 MCP 服务或临时脚本存在三大生产隐患：缺乏确定性的本地测试沙箱、运行依赖容易漂移断裂、缺乏人类业务规程约束容易导致模型越权调用。ActionDock 不替代 MCP 协议，而是为 MCP 及多种交付目标提供上游工程化底座：内置毫秒级纯内存单测沙箱、人定规程 Playbook 防越权机制、依赖锁定与事务回滚保障。同一份 Action 代码无需修改，即可一键交付为 MCP 协议服务、HTTP 微服务、便携技能包或本地命令行工具。

- 有多简单？
  仅需安装全局命令行工具 `@actiondock/cli`，使用 `defineAction` 编写纯粹的业务函数即可。框架自动处理协议序列化、网络传输、状态持久化与日志链路，无需编写冗余样板代码。

- 怎么开始？
  遵循下方清晰的黄金开发路径，五步即可完成从初始化到多形态交付的全流程。

---

## 黄金开发路径

开发与交付一个生产级 Action 仅需遵循以下五个标准步骤：

- 初始化工程脚手架：
  运行初始化命令创建项目骨架并安装依赖：
  ```bash
  ad init hello-tools
  cd hello-tools
  npm install
  ```

- 创建 Action 模板与契约：
  使用命令行工具一键生成强类型 Action 骨架与模式契约：
  ```bash
  ad action create greet -d "用户问候动作" --input name:string --output message:string
  ```

- 编写业务逻辑：
  在 `actions/greet.ts` 中实现具体的业务逻辑，享受强类型输入输出契约与上下文能力。

- 本地验证与自动化测试：
  在纯内存沙箱中执行毫秒级单元测试，并在本地命令行快速调用验证：
  ```bash
  # 运行单元测试套件
  npm test

  # 本地命令行调用验证
  ad run greet --input '{"name":"ActionDock"}'
  ```

- 多形态交付与导出：
  根据实际需求，一键交付为 MCP 协议服务，或打包为自包含的智能体技能包：
  ```bash
  # 启动标准 MCP 协议通信服务
  ad mcp

  # 导出自包含智能体技能包
  ad export skill
  ```

---

## 运行环境与原生设计红利
 
ActionDock 原生构建于 Node.js 版本大于等于 24.12.0 的现代运行底座。这一运行环境门槛为开发者带来了显著的原生工程红利：
 
- 原生类型擦除执行：直接执行 TypeScript 代码，生产运行时彻底脱离 Babel、esbuild、swc 等外部编译转译工具链。
- 轻量测试即时加载：单元测试由轻量加载器 `tsx` 原生驱动，测试开发阶段零编译等待，提供亚秒级反馈闭环。
- 内置 SQLite 存储引擎：依托内置模块 `node:sqlite` 提供轻量嵌入式状态存储与沙箱持久化能力，无需编译原生二进制扩展模块，杜绝外部数据库依赖。
- 原生 HTTP 服务：基于内置模块 `node:http` 原生支撑微服务与通信端点，杜绝冗余第三方 Web 框架，保障极低运行时开销。
- 极简依赖树：全链路告别庞大复杂的构建转译体系，保持纯粹敏捷的开发与交付体验。

---

## 人定规程，Agent 写实现

ActionDock 倡导人类业务掌控与智能体自主实现的明确分工：

- 人类编写操作规程 Playbook：在纯 Markdown 文件中划定业务时序、分支判断与安全红线，作为人类专家意图的唯一事实源。
- 智能体编写原子 Action：根据严格的输入输出契约实现功能，并通过测试套件自主校验与自愈。

```text
Playbook = 人类定义的业务规程（工作流时序、分支判定、安全红线）
Action   = 智能体实现的原子代码（强类型契约、纯粹业务能力）

             ↓ 统一交付

          Agent Skill 便携技能包 / MCP 协议服务 / HTTP 微服务
```

### 编写操作规程 Playbook

在 `playbooks/greet-user.md` 中以纯 Markdown 格式沉淀标准作业规程：

```markdown
# 用户问候标准作业规程

当会话中有新用户进入时，执行以下规程步骤：

- 验证用户真实姓名，严禁使用未经核实的昵称。
- 调用 greet 动作执行问候并获取历史问候频次。
- 若计数大于 1，在回答中体现老用户关怀。
```

在 `actiondock.json` 中声明规程与关联的 Action：

```json
{
  "playbooks": {
    "greet-user": {
      "entry": "playbooks/greet-user.md",
      "description": "用户问候标准作业规程",
      "actions": [
        "greet"
      ]
    }
  }
}
```

---

## 架构体系与子包划分

ActionDock 采用高内聚、低耦合的子包分层架构：

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

## 验证与测试命令

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
