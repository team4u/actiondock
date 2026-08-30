# ActionDock 2.0

> **一次构建，随处运行：面向 AI Agent 的 Action 开发与分发工具链。**

ActionDock 2.0 是一个基于 **Bun + TypeScript** 的轻量级开发工具链，专注于 AI Agent Action 与 Skill 的编写、调试、本地测试、独立构建与打包分发。命令行工具简称为 **`ac`**。

与传统的中心化 Server 架构不同，ActionDock 采用**零安装独立二进制（Zero-Install Standalone Executables）**交付模式：将一组 Action 及其依赖一键编译为单个自包含的可执行文件，配合 `SKILL.md` 任务指南组成完整的 Skill。最终消费者和 AI Agent **无需安装 ActionDock、Bun、Node.js、Python 或 Java** 即可直接调用。

---

## 核心特性

* **零依赖独立交付**：通过 Bun 原生编译引擎，将整个 Action Package 打包为单个独立的自包含二进制可执行文件。
* **文件系统优先（Filesystem First）**：Action（`actions/*.ts`）、Playbook（`playbooks/*.md`）与项目配置均为普通文件，天然适配 Git 版本管理、分支合并与代码评审。
* **TypeScript 原生开发**：统一平台与 Action 的编程语言，享受全类型安全约束与基于 `import` 的自然代码依赖闭包。
* **内置轻量持久化存储**：基于 `bun:sqlite` 内置存储，为 Action 提供开箱即用的运行时配置（Config）、持久化状态（Shared State）与执行历史记录（Runs）。
* **智能依赖自动安装**：开发态下 `ac run` 自动检测并毫秒级补齐缺失的 npm 依赖；构建态自动将依赖内联打包进单文件二进制。
* **标准 JSON Schema**：Action 的输入与输出均使用标准 JSON Schema，基于 `Ajv` 严格校验，无自定义 DSL 学习负担。
* **极简短命令 `ac`**：所有命令通过极速简洁的 `ac` 触发，执行结果输出标准 JSON Envelope 至 `stdout`，日志输出至 `stderr`。

---

## 安装与使用方式

### 从 npm 仓库安装（发布后 / 终端用户）

```bash
# 全局安装（推荐，安装后可全局直接使用 ac 命令）
bun install -g @actiondock/cli

# 或免安装临时执行（类似 npx）
bun x @actiondock/cli init my-tools
```

---

### 从源码开发（框架贡献者 / 未发布阶段）

```bash
# 克隆代码仓库
git clone git@github.com:team4u/actiondock.git
cd actiondock

# 安装全部 workspace 依赖
bun install

# 注册本地软链接到全局（修改源码实时生效）
cd packages/cli
bun link

# 验证安装：此时在系统任意位置均可直接使用 ac 命令
ac --help
```

> **注意**：在 `@actiondock/sdk` 正式发布到 npm 仓库之前，通过 `ac init` 初始化的独立项目执行 `bun install` 会因找不到远端包而报错，属正常现象。开发 Action Package 时建议直接使用仓库内的 `examples/github-tools` 作为模板，或在独立项目中将 `@actiondock/sdk` 声明为本地路径依赖（`"link:../../packages/sdk"`）。

---

## 快速上手

### 初始化新项目
```bash
ac init my-tools
cd my-tools
```

### 创建 Action
使用 CLI 命令快速生成 Action 模板：
```bash
ac action create greet.user --desc "向用户发送自定义问候语"
```

或直接编辑 `actions/user.ts`：
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "greet.user",
  description: "向用户发送自定义问候语",

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

  async run(input: { name: string }, ctx) {
    // 读取配置（优先级：命令行覆盖 > 本地/全局数据库 > 环境变量 > 声明默认值）
    const greeting = ctx.config.get("GREETING", "你好");

    // 读写持久化状态（跨执行保留）
    const count = ((await ctx.state.get<number>("count")) || 0) + 1;
    await ctx.state.set("count", count);

    // 打印结构化日志（走 stderr，不污染 stdout JSON 协议）
    ctx.log.info(`正在问候 ${input.name}（第 ${count} 次）`);

    return {
      message: `${greeting}，${input.name}！`,
      count,
    };
  },
});
```

### 开发态运行与调试
```bash
ac action run greet.user --input '{"name": "张三"}'
```

输出标准 JSON Envelope：
```json
{
  "ok": true,
  "runId": "a1b2c3d4-...",
  "data": {
    "message": "你好，张三！",
    "count": 1
  }
}
```

### 构建独立可执行文件
```bash
ac build
```

#### 交叉编译其他平台
基于 Bun 原生交叉编译能力，在任意一台开发机上即可构建全平台产物（无需 Docker 或目标平台工具链）：

```bash
ac build --target linux-x64      # Linux (x86-64)
ac build --target darwin-x64     # macOS (Intel)
ac build --target darwin-arm64   # macOS (Apple Silicon)
ac build --target windows-x64    # Windows (x86-64)
```

> **提示**：分平台构建时建议配合 `--out` 指定输出路径（如 `ac build --target linux-x64 --out dist/my-tools-linux-x64`），否则默认输出 `dist/my-tools` 会被后续构建覆盖。交叉编译适用于纯 TypeScript/JS 依赖；若 Action 引用了含原生二进制的 npm 包（如 `sharp`、`better-sqlite3`），请在对应平台的 CI 上构建。

### 导出自包含 Skill 交付包
```bash
ac export skill
```

导出其他平台的 Skill 交付包（目录名自动追加平台后缀，互不覆盖）：

```bash
ac export skill --target linux-x64   # 输出至 dist/my-tools-skill-linux-x64/
```

导出的 Skill 目录结构：
```text
dist/my-tools-skill/
├── SKILL.md                  # 面向 AI Agent 的调用说明与任务指南
├── actiondock.skill.json     # Skill 结构化清单
├── playbooks/                # 任务 SOP Markdown 引导文档
└── bin/
    └── my-tools              # 自包含独立二进制（目标机器无需安装任何 Runtime）
```

---

## 进阶指南与完整文档体系

完整文档索引见 [docs/](docs/README.md)：

### 核心开发
* **[快速上手指南](docs/quick-start.md)**：从环境准备到首个 Action 导出。
* **[Skill 设计哲学与交付指南](docs/skill-guide.md)**：Action/Playbook/Skill 三层模型、构成规范与分发。
* **[Action 编写与开发指南](docs/action-authoring.md)**：Action 声明结构、JSON Schema 定义与标准 Web API 实践。
* **[ActionContext 核心能力详解](docs/action-context.md)**：`ctx.config`、`ctx.state`、`ctx.actions` 与 `ctx.log` 深度剖析。

### 规程与分发
* **[Playbook SOP 编写指南](docs/playbook-guide.md)**：面向 AI Agent 的标准操作规程规范与校验。
* **[存储与状态管理机制](docs/storage-and-state.md)**：SQLite 存储模型、表结构索引与路径解析。
* **[多环境与云机器调度指南](docs/remote-and-profiles.md)**：Profile 管理、`ac serve` 轻量 Runner 与多云节点执行。
* **[Model Context Protocol (MCP) 适配器指南](docs/mcp-integration.md)**：STDIO 与 HTTP 协议、Tool 映射、取消链路与 Agent IDE 直连。
* **[构建编译与 Skill 分发](docs/build-and-export.md)**：Bun.build 编译、`artifact.json` 元数据与 Skill 打包。
* **[AI Agent 接入与集成指南](docs/agent-integration.md)**：Antigravity、Claude Code、Cursor 等主流 Agent 框架接入。

### 参考与排错
* **[CLI 命令参考手册 (`ac`)](docs/cli-reference.md)**：全量命令、参数选项与 JSON 协议规范。
* **[测试与验证指南](docs/testing-guide.md)**：内存单元测试与独立编译契约测试。
* **[错误代码与排错手册](docs/error-codes.md)**：标准运行时错误码定义与修复指引。
* **[1.0 到 2.0 迁移指南](docs/v1-to-v2-migration.md)**：旧版平台与 2.0 新架构概念映射。
* **[ActionDock AI Agent 技能指南](skills/actiondock/SKILL.md)**：专门面向 AI 编程助手与自主 Agent 的开发规范。

---

## CLI 命令速查表 (`ac`)

| 命令 | 功能描述 |
| :--- | :--- |
| `ac init [dir]` | 在指定目录初始化脚手架新项目 |
| `ac info [--json]` | 查看当前项目元数据、Action 与 Playbook 清单 |
| `ac link [path]` | 将本地 Action Package 注册到全局注册表（实现跨目录源码直跑） |
| `ac unlink [id\|path]` | 从全局注册表中注销指定包 |
| `ac action create <id>` | 快速生成新的 Action 声明模板文件 |
| `ac action list [patterns...] [-i <regex>] [--json]` | 列出 Action（支持正则意图 `-i`、多关键字模糊查找与未命中回退） |
| `ac action show <id> [--json]` | 查看指定 Action 的详细定义与入参出参 Schema |
| `ac action run <id> --input '<json>' [--timeout <t>]` | 运行 Action 并输出标准结果 JSON（支持超时限制与 Ctrl+C 取消） |
| `ac action validate` | 校验 Action 与 JSON Schema 语法合法性 |
| `ac mcp [--dir <d>] [--package <p>]` | 启动 MCP (Model Context Protocol) STDIO 服务端（Claude Code / Cursor 直连） |
| `ac mcp serve [--port <p>] [--host <h>]` | 启动 MCP Streamable HTTP 协议微服务（默认监听 127.0.0.1:5178） |
| `ac playbook create <id>` | 快速生成新的 Playbook SOP 模板文件 |
| `ac playbook list [patterns...] [-i <regex>]` | 查看任务 SOP 指南 Playbook（支持模糊/正则意图收窄） |
| `ac config list [patterns...] [-i <regex>]` | 查看与管理本地 SQLite 运行时配置（支持意图过滤） |
| `ac state list [prefix] [-i <regex>]` | 查看与管理本地 SQLite 共享状态存储（支持前缀与意图正则） |
| `ac runs list [patterns...] [-i <regex>]` | 查看 Action 执行历史与输入输出记录（支持意图过滤） |
| `ac profile list [--reveal] [--json]` | 管理多环境与远程云机器 Profile（支持 Token 来源标注与脱敏） |
| `ac serve [--port <p>] [--host <h>]` | 启动轻量安全 HTTP Runner 服务端（默认安全监听 127.0.0.1） |
| `ac test` | 使用 Bun Test Runner 执行单元测试 |
| `ac build [--target <target>] [--out <path>]` | 将项目编译为单个自包含独立二进制（支持交叉编译：`linux-x64` / `darwin-x64` / `darwin-arm64` / `windows-x64`） |
| `ac export skill [--target <target>] [--out <path>]` | 导出包含 `SKILL.md` + 独立二进制的完整 Skill 交付包 |

---

## 代码仓库分层结构

* [`packages/sdk`](packages/sdk)：`@actiondock/sdk` 极简公共 SDK（`defineAction`、核心上下文类型、`createTestRuntime` 内存测试工具），零重依赖。
* [`packages/core`](packages/core)：`@actiondock/core` 底层领域引擎（项目加载、ActionRunner 执行器、SQLite 存储管理、Ajv Schema 校验、Bun.build 单文件编译与 Skill 导出）。
* [`packages/mcp`](packages/mcp)：`@actiondock/mcp` Model Context Protocol 适配器（STDIO 与 HTTP 协议、Tool 映射与取消链路）。
* [`packages/cli`](packages/cli)：`@actiondock/cli` 命令行门面（`ac`），负责参数解析与终端交互。
* [`examples/github-tools`](examples/github-tools)：官方完整 GitHub 工具集示例（Action 组合调用、持久化 Checkpoint 与 Skill 导出演示）。

---

## 自动化测试与类型检查

```bash
# 运行全仓库所有测试
bun test

# 运行 TypeScript 类型检查
bun run typecheck
```

---

## 开源协议

Apache-2.0
