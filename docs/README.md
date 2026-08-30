# ActionDock 2.0 官方文档

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-65%20passed-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> 面向 AI Agent 的 Action 与 Skill 开发、测试、构建与分发工具链。

ActionDock 2.0 是一套专为 AI Agent 研发与交付场景打造的轻量级、零环境依赖的基础工具链。平台遵循“**独立自包含交付、文件系统优先、强类型标准契约、通道绝对隔离、开发构建一致**”的设计哲学，帮助开发者与团队极速编写、调试、测试、独立构建与打包分发 AI Agent 工具集。

---

## 组件与功能分类导航

### 核心开发与 SDK 规范

提供极简强类型的 SDK，统一 Action 定义、上下文能力、输入输出校验与内存单元测试。

| 模块 / 主题 | 对应包 / 路径 | 说明与核心场景 | 文档入口 |
| :--- | :--- | :--- | :--- |
| **Action 编写指南** | `@actiondock/sdk` · `actions/*.ts` | 基于 `defineAction` 声明 Action、TypeScript 泛型绑定、标准 JSON Schema 校验、标准 Web API 与 npm 依赖管理。 | [概览与实践](action-authoring.md) · [快速开始](quick-start.md) |
| **ActionContext 详解** | `@actiondock/sdk` · `ActionContext` | 5 大上下文核心能力剖析：`ctx.config`（5 级优先级解析）、`ctx.state`（SQLite 持久化 KV 与 TTL）、`ctx.actions`（组合调用与循环防御）、`ctx.log`（stderr 隔离输出）与 `ctx.signal`（Web AbortSignal 取消链路）。 | [Context 详解](action-context.md) |
| **测试与验证指南** | `@actiondock/sdk` · `tests/*.test.ts` | 极速纯内存单测工具 `createTestRuntime`，支持配置预填、初始状态注入、日志断言以及独立编译契约测试（Contract Testing）。 | [测试指南](testing-guide.md) |

---

### 规程编排与 Skill 交付

将原子 Action、标准 SOP 操作规程与独立二进制统一打包为面向 AI Agent 的最高级自包含交付物。

| 模块 / 主题 | 对应包 / 路径 | 说明与核心场景 | 文档入口 |
| :--- | :--- | :--- | :--- |
| **Skill 设计哲学与规范** | `dist/*-skill/` · `SKILL.md` | Action/Playbook/Skill 三层关系与生命周期、`SKILL.md` YAML Frontmatter 规范、`actiondock.skill.json` 机器清单与交叉导出。 | [Skill 规范](skill-guide.md) |
| **Playbook SOP 编写指南** | `playbooks/*.md` | 面向 AI Agent 的领域操作规程编写规范，包含前置检查、阶段操作、分支决策与安全红线，支持 `ac playbook validate` 语法校验。 | [Playbook 规范](playbook-guide.md) |
| **构建编译与 Skill 分发** | `@actiondock/core` · `ac build` | `Bun.build` 单文件单包独立编译原理、全平台交叉编译（Linux/macOS/Windows）、全量打包与基于 Playbook 的 Tree-shaking 按需裁剪。 | [构建与分发](build-and-export.md) |

---

### 运行时架构与持久化存储

基于 `bun:sqlite` 的自包含存储模型与全链路执行生命周期管理。

| 模块 / 主题 | 对应包 / 路径 | 说明与核心场景 | 文档入口 |
| :--- | :--- | :--- | :--- |
| **存储与状态管理机制** | `bun:sqlite` · `RuntimeStorage` | 纯运行态嵌入式 SQLite 数据模型（`config`、`state`、`runs` 表结构）、路径解析策略（开发态 vs 独立态）、TTL 惰性清理与 `PRAGMA user_version` 事务迁移。 | [存储与状态](storage-and-state.md) |
| **安全加固与执行生命周期** | `@actiondock/core` · `ActionRunner` | 系统核心设计底线：唯一执行核心 `ActionRunner`、Security Hardening 规范、`ExecutionManager` 内存句柄、超时机制与 26 条验收标准。 | [设计与生命周期](design-security-mcp-execution.md) |

---

### 协议适配与多环境调度

支持 Model Context Protocol (MCP) 标准直连与多云异构环境调度。

| 模块 / 主题 | 对应包 / 路径 | 说明与核心场景 | 文档入口 |
| :--- | :--- | :--- | :--- |
| **MCP 适配器指南** | `@actiondock/mcp` · `ac mcp` | 提供 STDIO 与 Streamable HTTP 双模 Transport，Schema 零冗余映射，支持多目录/多包聚合与 MCP Tasks 异步长任务扩展（`tasks/get`、`tasks/cancel`、`tasks/list`）。 | [MCP 适配器指南](mcp-integration.md) |
| **多环境与远程调度指南** | `ac profile` · `ac serve` | 在远端云机器启动轻量 HTTP Runner（`ac serve`），本地通过 Profile 管理多云节点（支持 `tokenEnv` 环境变量管理与 `0o600` 权限安全），支持异步长任务（`--async`）调度与取消。 | [多环境调度指南](remote-and-profiles.md) |
| **AI Agent 接入与集成指南** | Antigravity / Claude / Cursor | 主流 AI Agent（Antigravity、Claude Code、Cursor、Windsurf、自定义 LLM Agent）接入方案对比（MCP 直连 vs 独立 Skill 二进制）。 | [Agent 集成指南](agent-integration.md) |

---

### 工具参考、排错与演进

全量 CLI 指令速查、结构化错误排查及版本演进指南。

| 模块 / 主题 | 对应包 / 路径 | 说明与核心场景 | 文档入口 |
| :--- | :--- | :--- | :--- |
| **CLI 命令行参考手册** | `@actiondock/cli` (`ac`) | 全量命令、参数选项、正则/模糊意图过滤规则、退出码与标准 JSON Envelope 输出规范。 | [CLI 命令手册](cli-reference.md) |
| **错误代码与排错手册** | 全局运行时错误体系 | 标准错误 Envelope 结构、全量错误代码定义（`INPUT_VALIDATION_FAILED`、`ACTION_TIMEOUT`、`ACTION_CYCLE_DETECTED` 等）与排查修复建议。 | [错误排错手册](error-codes.md) |
| **1.0 到 2.0 迁移指南** | 架构演进与版本对比 | 从 1.0 中心化 Java/Spring 服务端到 2.0 Bun 独立编译工具链的 7 维核心对比与代码迁移实战。 | [迁移对比指南](v1-to-v2-migration.md) |
| **AI Agent 技能指南** | `skills/actiondock/SKILL.md` | 专门面向 AI 编程助手与自主 Agent 的标准开发规程与工具链调用手册。 | [Agent Skill 指南](../skills/actiondock/SKILL.md) |

---

## 快速接入流程

### 引入与安装
```bash
# 全局安装 ActionDock CLI
bun install -g @actiondock/cli
```

### 初始化项目
```bash
ac init github-tools --id team4u.github-tools --name "GitHub Tools"
cd github-tools
```

### 创建并编写 Action (`actions/get-pr.ts`)
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "github.get-pr",
  description: "获取指定 Pull Request 的详细信息",

  inputSchema: {
    type: "object",
    properties: {
      prNumber: { type: "number", description: "PR 编号" },
    },
    required: ["prNumber"],
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

    const res = await fetch(`https://api.github.com/repos/team4u/framework/pulls/${input.prNumber}`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "User-Agent": "ActionDock-Agent",
      },
      signal: ctx.signal,
    });

    if (!res.ok) throw new Error(`GitHub API Error: ${res.status}`);
    const data = (await res.json()) as any;

    return {
      id: data.id,
      title: data.title,
      state: data.state,
    };
  },
});
```

### 开发调试与运行
```bash
ac run github.get-pr --input '{"prNumber": 101}'
```

### 编译为零外部依赖独立二进制
```bash
ac build
```

### 一键导出自包含 Skill 交付包
```bash
ac export skill
```

---

## 设计哲学

- **轻量与自包含（Lightweight & Self-Contained）**：彻底摆脱传统框架对复杂运行时环境、虚拟机或集中式控制台的强依赖，编译后的产物可在任何干净的操作系统直接运行。
- **契约严格一致（Standalone Contract Invariance）**：无论在本地 CLI、云端 Runner、MCP Server 还是编译后的独立二进制中，Action 的入参校验、配置解析、持久化状态与返回值协议均保持 100% 行为一致。
- **标准与生态复用（Standard Web & npm Ecosystem）**：直接使用原生 Web 标准（`fetch`、`AbortSignal`、`JSON Schema`）与丰富 npm 生态包，不发明封闭的专有 DSL。
- **纯净通道隔离（Clean Channel Separation）**：严格区分数据通道（`stdout` 机器 JSON Envelope）与可观测日志通道（`stderr` 诊断输出），从物理层面避免 LLM 语法解析崩溃。
- **白盒链路可溯（Traceable Execution Lifecycle）**：内置基于 SQLite 的 Runs 历史与父子 Action 级联追踪，支持循环调用防御与全链路响应式取消。
