# ActionDock 2.0

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-67%20passed-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> 把代码变资产，让工具即契约。
> 面向 AI Agent 的工具开发、测试、独立编译与分发工具链。
> 用 TypeScript 编写原子工具，毫秒级纯内存单测，一键编译为零依赖独立二进制，原生直连 MCP 与 Agent Skill。

---

## 为什么需要 ActionDock？

在为 AI Agent（Claude Code、Cursor、Antigravity 或自定义智能体）编写和交付工具时，工程师通常会反复踩进几个真实的工程泥潭：

* **工具定义与代码实现脱节（两张皮）**：
  给 AI 做工具时，往往需要在外部平台或 Prompt 提示词里手动手写一份工具入参描述。代码一旦改动，参数文档和类型极易脱节，下游大模型因拿不到精确的 Schema 约束而频繁产生幻觉。
* **可视化拖拽（如 Dify / n8n）无法承载复杂工程逻辑**：
  画布拖拽在简单 Demo 阶段很直观，但在面对真实的工程业务时（精细分支判断、失败重试、循环调用防御、代码评审 Code Review、Git 版本控制、敏感配置隔离），连线迅速退化为密密麻麻、无法维护的“蜘蛛网”。
* **目标机器的环境泥潭与依赖漂移**：
  写好的 Python 或 Node.js 工具脚本，部署到新的生产机器、Docker 沙箱或交给 Agent 执行时，频繁因为目标机器缺少运行时、Python 虚拟环境未激活、Node 版本冲突或数万个 `node_modules` 文件难以传输而无法启动。
* **调试日志污染导致大模型解析崩溃**：
  在工具中随手写了一句 `console.log`，或者引用的第三方库在初始化时打印了一行版本提示，这些非 JSON 字符直接混入标准输出（`stdout`），导致大模型的 JSON 解析器直接报错、长任务中断。
* **多端入口割裂，同一套逻辑重复封装**：
  在本地 IDE 里调试需要写一套 MCP 适配层；部署到远程机器需要写一套 HTTP/REST 包装；交付给自主智能体又需要手写一套 SOP 提示词，同一份业务逻辑被迫维护多套实现。

ActionDock 围绕 **“代码即契约、文件系统优先、自包含独立编译、物理通道绝对隔离、全模态多端复用”** 重构了工具的研发与交付体系。

---

## 核心机制

* **代码即契约（Schema-Driven）**：通过 `defineAction` 原生绑定 TypeScript 泛型与标准 JSON Schema，入参与出参自动执行严格校验。代码、类型定义、数据校验与 Agent 工具描述四位一体，杜绝文档脱节。
* **文件系统优先（Git-Native）**：原子工具（`actions/*.ts`）与操作规程（`playbooks/*.md`）均为纯文本文件，天然纳入 Git 版本控制，直接享受 IDE 智能补全、分支评审与 CI/CD 流水线。
* **零依赖单文件独立编译**：基于 Bun 原生单文件编译引擎，将 TypeScript 源码与引用的 npm 依赖全量 Tree-shaking 并内联打包为单文件可执行文件（`ac build`）。目标机器无需安装 Node.js、Bun、Python 或任何运行环境，开箱即用。
* **物理级标准输入输出隔离**：数据通道（`stdout`）严格只输出格式统一的机器 JSON Envelope；所有业务日志与调试诊断（`ctx.log`）强制输出至错误通道（`stderr`），从底层彻底杜绝大模型解析崩溃。
* **双模生态与全场景复用**：同一个 Action Package，既可以通过 `ac mcp` 作为 Model Context Protocol 服务端供桌面 IDE 毫秒级直连，也可以通过 `ac export skill` 一键导出包含领域 SOP 规程（Playbook）的自包含 Skill 交付包，或者通过 `ac serve` 在远程云机器上提供轻量 HTTP 调度。
* **纯内存毫秒级测试运行时**：提供 `createTestRuntime` 内存测试沙箱，无需启动外部服务，无需连接真实数据库，5 毫秒内完成配置覆盖、持久化状态验证与 Action 级联调用测试。

---

## 快速上手

### 安装命令行工具 (`ac`)

通过 Bun 全局安装 ActionDock 命令行工具门面：

```bash
bun install -g @actiondock/cli
```

### 初始化与创建 Action

初始化一个标准 Action Package 脚手架：

```bash
ac init github-tools --id team.github-tools --name "GitHub Tools"
cd github-tools
```

编辑 `actions/get-pr.ts`，使用 `@actiondock/sdk` 声明一个具备严格 JSON Schema 入参出参校验的 Action：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "github.get-pr",
  description: "获取指定 GitHub Pull Request 的详细信息",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "仓库全名 (例如 team4u/framework)" },
      prNumber: { type: "number", description: "PR 编号" },
    },
    required: ["repo", "prNumber"],
  },

  outputSchema: {
    type: "object",
    properties: {
      id: { type: "number" },
      title: { type: "string" },
      state: { type: "string" },
    },
    required: ["id", "title", "state"],
  },

  async run(input, ctx) {
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    ctx.log.info(`正在查询 PR #${input.prNumber}`);

    const res = await fetch(`https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "User-Agent": "ActionDock-Agent",
      },
      signal: ctx.signal,
    });

    if (!res.ok) throw new Error(`GitHub API 报错: HTTP ${res.status}`);
    const data = (await res.json()) as any;

    return {
      id: data.id,
      title: data.title,
      state: data.state,
    };
  },
});
```

### 本地开发运行与调试

使用 `ac run` 在本地直接运行 Action：

```bash
ac run github.get-pr --input '{"repo": "team4u/framework", "prNumber": 101}'
```

命令将在 `stdout` 输出纯净的标准 JSON Envelope，供大模型或程序安全解析：

```json
{
  "ok": true,
  "runId": "01JXYZ...",
  "data": {
    "id": 1024,
    "title": "feat: upgrade to ActionDock 2.0",
    "state": "open"
  }
}
```

而在 `stderr` 中输出格式化诊断日志：

```text
[15:30:00] [INFO] [github.get-pr] 正在查询 PR #101
```

### 作为 MCP 服务直连 IDE

无需编写任何额外适配层，直接启动当前包为 MCP 服务，供 Claude Code、Cursor、Windsurf 等客户端使用：

```bash
# 启动 STDIO 模式 MCP 服务
ac mcp

# 或启动 HTTP 模式 MCP 微服务（监听 5178 端口）
ac mcp --port 5178 --token my-secret-token
```

### 编译为零依赖独立二进制

执行 `ac build` 将整个 Action Package 编译为单个自包含可执行程序：

```bash
ac build
```

编译产物位于 `dist/bin/github-tools`。将该单文件传输到任何目标机器，无需安装任何环境直接执行：

```bash
./dist/bin/github-tools run github.get-pr --input '{"repo": "team4u/framework", "prNumber": 101}'
```

### 导出自包含 Agent Skill 交付包

```bash
# 导出源码型 Skill（轻量、跨平台）
ac export skill

# 或导出独立二进制型 Skill（零外部依赖，自带预编译二进制）
ac export skill --standalone
```

---

## 方案对比

| 评估维度 | 裸脚本 / 自建 HTTP 封装 | 可视化拖拽工作流 (Dify / n8n) | ActionDock 2.0 工具链 |
| :--- | :--- | :--- | :--- |
| **系统表达媒介** | 散落的脚本文件与临时接口 | 画布节点与可视化连线（易成蜘蛛网） | **TypeScript 源码 + 标准 JSON Schema** |
| **工具契约维护** | 代码与文档容易脱节，无输出约束 | 依赖画布节点配置，难以做严谨类型推导 | **代码即契约**，入参出参强制 Ajv 校验 |
| **目标机运行环境** | 必须安装 Node/Python、传输 `node_modules` | 依赖庞大复杂的中心化后端平台 | **零依赖单文件二进制**，无需任何运行时 |
| **输出通道纯净度** | 日志与数据混杂在 stdout，易搞崩 LLM | 平台黑盒包装，难以捕获精细底层诊断 | **物理通道隔离**：数据走 stdout，日志走 stderr |
| **协议生态对接** | 需手写 MCP STDIO/HTTP 协议转换 | 需额外配置 Prompt 映射层与插件 | **原生内置 MCP 与 Skill 标准**，一行命令直连 |
| **复杂规程约束** | 无法约束智能体的操作顺序与高危红线 | 依赖连线逻辑，条件复杂时难以扩展 | **Playbook SOP** 结构化声明步骤与拦截红线 |
| **版本控制与协作** | 简单脚本缺乏生命周期审计 | 依赖特定平台自身的历史记录 | **Git 原生管理**，代码评审与分支合并无缝支持 |
| **测试验证效率** | 依赖真实环境或外部 DB，测试缓慢 | 只能在画布上点选触发，难以做单元测试 | **内置纯内存测试运行时**，5 毫秒完成验证 |

---

## 模块分层与代码结构

ActionDock 采用分层清晰的 Monorepo 结构：

```text
actiondock/
├── packages/
│   ├── sdk/          # @actiondock/sdk：极简公共 SDK（defineAction, ActionContext, createTestRuntime）
│   ├── core/         # @actiondock/core：公共领域内核（Runner, Storage, Schema, Build, Export）
│   ├── mcp/          # @actiondock/mcp：Model Context Protocol 适配器（STDIO / HTTP / Tasks 扩展）
│   └── cli/          # @actiondock/cli：命令行门面工具链（ac）
├── examples/
│   └── github-tools/ # 官方完整示例 Action Package
├── docs/             # 官方完整技术文档中心
└── skills/           # 面向 AI 助手的官方 Skill 规范
```

---

## 文档导航

- **[快速开始](docs/quick-start.md)**：从环境准备到首个 Action 导出的 5 分钟实战教程。
- **[Action 编写与开发指南](docs/action-authoring.md)**：强类型定义、Schema 校验、依赖管理与 Action 组合。
- **[ActionContext 核心能力详解](docs/action-context.md)**：5 级配置回退、持久化状态、日志隔离与 AbortSignal 取消链路。
- **[测试与验证指南](docs/testing-guide.md)**：纯内存测试沙箱与独立编译契约测试。
- **[Model Context Protocol 适配器指南](docs/mcp-integration.md)**：STDIO / HTTP 双模 Transport、Tool 映射与 MCP Tasks 异步长任务扩展。
- **[Skill 设计哲学与交付规范](docs/skill-guide.md)**：源码型与独立便携型 Skill 交付规范。
- **[Playbook SOP 编写规范](docs/playbook-guide.md)**：面向智能体的领域操作规程编写与语法校验。
- **[存储与状态管理机制](docs/storage-and-state.md)**：基于 SQLite 的运行态配置、状态与执行历史模型。
- **[多环境与远程云机器调度指南](docs/remote-and-profiles.md)**：Profile 命名配置与轻量 HTTP Runner（`ac serve`）。
- **[CLI 命令行参考手册](docs/cli-reference.md)**：全量命令、参数选项与退出码速查。

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
