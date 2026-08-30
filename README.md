# ActionDock 2.0

> **一次构建，随处运行：面向 AI Agent 的 Action 开发与分发工具链。**

ActionDock 2.0 是一个基于 **Bun + TypeScript** 的轻量级开发工具链，专注于 AI Agent Action 与 Skill 的编写、调试、本地测试、独立构建与打包分发。

与传统的中心化 Server 架构不同，ActionDock 采用**零安装独立二进制（Zero-Install Standalone Executables）**交付模式：将一组 Action 及其依赖一键编译为单个自包含的可执行文件，配合 `SKILL.md` 任务指南组成完整的 Skill。最终消费者和 AI Agent **无需安装 ActionDock、Bun、Node.js、Python 或 Java** 即可直接调用。

---

## 🌟 核心特性

* **零依赖独立交付**：通过 Bun 原生编译引擎，将整个 Action Package 打包为单个独立的自包含二进制可执行文件。
* **文件系统优先（Filesystem First）**：Action（`actions/*.ts`）、Playbook（`playbooks/*.md`）与项目配置均为普通文件，天然适配 Git 版本管理、分支合并与代码评审。
* **TypeScript 原生开发**：统一平台与 Action 的编程语言，享受全类型安全约束与基于 `import` 的自然代码依赖闭包。
* **内置轻量持久化存储**：基于 `bun:sqlite` 内置存储，为 Action 提供开箱即用的运行时配置（Config）、持久化状态（Shared State）与执行历史记录（Runs）。
* **标准 JSON Schema**：Action 的输入与输出均使用标准 JSON Schema，基于 `Ajv` 严格校验，无自定义 DSL 学习负担。
* **Agent 友好交互协议**：全量 CLI 命令统一规范：标准执行结果走 `stdout`（格式化 JSON Envelope），日志与诊断信息走 `stderr`。

---

## 📦 安装与使用方式

ActionDock CLI 提供了两种使用方式：**从 npm 官方仓库安装** 与 **从本地源码打包安装**。

### 方式 1：从 npm 仓库安装（发布后 / 终端用户）

如果您希望在任何环境直接使用已经发布的官方包：

```bash
# 全局安装（推荐，安装后可全局直接使用 actiondock 命令）
bun install -g @actiondock/cli

# 或免安装临时执行（类似 npx）
bun x @actiondock/cli init my-tools
```

---

### 方式 2：从本地源码打包与安装（源码开发 / 未发布阶段）

如果您克隆了本项目源码，或正在进行 ActionDock 本身的功能二次开发：

#### 方法 A：使用 `bun link` 建立本地软链接（最推荐，修改代码实时生效）
```bash
# 1. 进入 CLI 源码目录
cd packages/cli

# 2. 注册本地软链接到全局
bun link

# 3. 此时在系统任意位置均可直接使用 actiondock 命令！
actiondock --help
```

#### 方法 B：本地打包为 `.tgz` 压缩包安装
```bash
# 1. 在 packages/cli 目录下打包
cd packages/cli
bun pm pack

# 2. 全局安装生成的本地 tarball 包
bun install -g ./actiondock-cli-2.0.0.tgz
```

#### 方法 C：通过本地路径直接全局安装
```bash
# 在项目根目录下执行
bun install -g ./packages/cli
```

#### 方法 D：直接运行本地脚本入口
```bash
# 在项目根目录下通过 Bun 运行入口文件
bun packages/cli/bin/actiondock.js <命令>
```

---

## 🚀 快速上手

### 1. 初始化新项目
```bash
# 使用已安装的全局命令
actiondock init my-tools
cd my-tools

# 或使用 bun x 免安装初始化
# bun x @actiondock/cli init my-tools
```

### 2. 创建 Action
使用 CLI 命令快速生成 Action 模板：
```bash
actiondock action create greet.user --desc "向用户发送自定义问候语"
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
    // 读取配置（优先级：命令行覆盖 > 本地数据库 > 默认值）
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

### 3. 开发态运行与调试
```bash
actiondock action run greet.user --input '{"name": "张三"}'
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

### 4. 构建独立可执行文件
```bash
actiondock build
```

### 5. 导出自包含 Skill 交付包
```bash
actiondock export skill
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

## 📚 进阶指南与文档

* **[Action 编写与开发指南](file:///root/code/action-dock/docs/action-authoring.md)**：详细解析 Action 定义、`ActionContext` API（`config`/`state`/`actions`/`log`）、JSON Schema 规范及内存单测工具。
* **[CLI 命令参考手册](file:///root/code/action-dock/docs/cli-reference.md)**：全量 CLI 命令、参数选项、过滤规则及退出码说明。
* **[ActionDock AI Agent 技能指南](file:///root/code/action-dock/skills/actiondock/SKILL.md)**：专门面向 AI 编程助手与自主 Agent 的开发规范。
* **[2.0 架构设计文档](file:///root/code/action-dock/ActionDock_2.0_Design.md)**：ActionDock 2.0 的完整重构架构、设计哲学与约束边界。

---

## 🛠️ CLI 命令速查表

| 命令 | 功能描述 |
| :--- | :--- |
| `actiondock init [dir]` | 在指定目录初始化脚手架新项目 |
| `actiondock info [--json]` | 查看当前项目元数据、Action 与 Playbook 清单 |
| `actiondock action create <id>` | 快速生成新的 Action 声明模板文件 |
| `actiondock action list [--json]` | 列出当前项目中的所有 Action |
| `actiondock action show <id> [--json]` | 查看指定 Action 的详细定义与入参出参 Schema |
| `actiondock action run <id> --input '<json>'` | 运行 Action 并输出标准结果 JSON |
| `actiondock action validate` | 校验 Action 与 JSON Schema 语法合法性 |
| `actiondock playbook create <id>` | 快速生成新的 Playbook SOP 模板文件 |
| `actiondock playbook list / show <id>` | 查看任务 SOP 指南 Playbook |
| `actiondock config list / get / set / delete` | 查看与管理本地 SQLite 运行时配置 |
| `actiondock state list / get / set / delete` | 查看与管理本地 SQLite 共享状态存储 |
| `actiondock runs list / show <run-id>` | 查看 Action 执行历史与输入输出记录 |
| `actiondock test` | 使用 Bun Test Runner 执行单元测试 |
| `actiondock build [--target <target>]` | 将项目编译为单个自包含独立二进制 |
| `actiondock export skill [--target <target>]` | 导出包含 `SKILL.md` + 独立二进制的完整 Skill 交付包 |

---

## 📦 代码仓库分层结构

* [`packages/sdk`](file:///root/code/action-dock/packages/sdk)：`@actiondock/sdk` 极简公共 SDK（`defineAction`、核心上下文类型、`createTestRuntime` 内存测试工具），零重依赖。
* [`packages/core`](file:///root/code/action-dock/packages/core)：`@actiondock/core` 底层领域引擎（项目加载、ActionRunner 执行器、SQLite 存储管理、Ajv Schema 校验、Bun.build 单文件编译与 Skill 导出）。
* [`packages/cli`](file:///root/code/action-dock/packages/cli)：`@actiondock/cli` 命令行门面，负责参数解析与终端交互。
* [`examples/github-tools`](file:///root/code/action-dock/examples/github-tools)：官方完整 GitHub 工具集示例（Action 组合调用、持久化 Checkpoint 与 Skill 导出演示）。

---

## 🧪 自动化测试与类型检查

```bash
# 运行全仓库所有测试
bun test

# 运行 TypeScript 类型检查
bun run typecheck
```

---

## 开源协议

Apache-2.0
