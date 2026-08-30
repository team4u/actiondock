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
* **标准 JSON Schema**：Action 的输入与输出均使用标准 JSON Schema，基于 `Ajv` 严格校验，无自定义 DSL 学习负担。
* **极简短命令 `ac`**：所有命令通过极速简洁的 `ac` 触发，执行结果输出标准 JSON Envelope 至 `stdout`，日志输出至 `stderr`。

---

## 安装与使用方式

### 方式 1：从 npm 仓库安装（发布后 / 终端用户）

```bash
# 全局安装（推荐，安装后可全局直接使用 ac 命令）
bun install -g @actiondock/cli

# 或免安装临时执行（类似 npx）
bun x @actiondock/cli init my-tools
```

---

### 方式 2：从本地源码安装（框架开发者 / 未发布阶段）

#### 开发前准备：克隆并链接
```bash
# 1. 克隆仓库并安装依赖（monorepo workspace 会自动链接内部包）
git clone https://github.com/team4u/actiondock.git
cd actiondock
bun install

# 2. 注册 ac 命令到全局（修改源码实时生效）
cd packages/cli
bun link
```

#### 方法 A：使用 `bun link` 建立本地软链接（最推荐，修改代码实时生效）
```bash
# 上面的 bun link 已经完成注册，此时在系统任意位置均可直接使用 ac 命令
ac --help
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
bun packages/cli/bin/ac.js <命令>
```

> **⚠️ 框架开发者请注意**：`ac init` 创建的是面向最终用户的独立项目，其 `package.json` 依赖为 `"@actiondock/sdk": "^2.0.0"`。在 SDK 正式发布到 npm 之前，这些独立项目执行 `bun install` 会报 404，这是预期行为。**开发框架本身请在 monorepo 内进行**（例如在 `examples/` 下新建项目），内部包通过 `workspace:*` 引用，参见 `examples/github-tools/package.json`。

---

## 快速上手

### 1. 初始化新项目
```bash
ac init my-tools
cd my-tools
```

> **⚠️ 注意**：`ac init` 生成的独立项目依赖 `@actiondock/sdk@^2.0.0`，该包尚未发布到 npm，发布前 `bun install` 会报 404。框架贡献者请在 monorepo 内开发（见上文「方式 2」的说明）。

### 2. 创建 Action
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

### 4. 构建独立可执行文件
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

> **💡 提示**：分平台构建时建议配合 `--out` 指定输出路径（如 `ac build --target linux-x64 --out dist/my-tools-linux-x64`），否则默认输出 `dist/my-tools` 会被后续构建覆盖。交叉编译适用于纯 TypeScript/JS 依赖；若 Action 引用了含原生二进制的 npm 包（如 `sharp`、`better-sqlite3`），请在对应平台的 CI 上构建。

### 5. 导出自包含 Skill 交付包
```bash
ac export skill
```

导出其他平台的 Skill 交付包（目录名自动追加平台后缀，互不覆盖）：

```bash
ac export skill --target linux-x64   # → dist/my-tools-skill-linux-x64/
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

## 进阶指南与文档

* 完整文档索引见 [docs/](docs/README.md)，核心几篇：
  * **[Action 编写与开发指南](docs/action-authoring.md)**：详细解析 Action 定义、`ActionContext` API（`config`/`state`/`actions`/`log`）、JSON Schema 规范及内存单测工具。
  * **[CLI 命令参考手册 (`ac`)](docs/cli-reference.md)**：全量 CLI 命令、参数选项、过滤规则及退出码说明。
  * **[2.0 架构设计文档](docs/architecture.md)**：ActionDock 2.0 的完整重构架构、设计哲学与约束边界。
* **[ActionDock AI Agent 技能指南](skills/actiondock/SKILL.md)**：专门面向 AI 编程助手与自主 Agent 的开发规范。

---

## CLI 命令速查表 (`ac`)

| 命令 | 功能描述 |
| :--- | :--- |
| `ac init [dir]` | 在指定目录初始化脚手架新项目 |
| `ac info [--json]` | 查看当前项目元数据、Action 与 Playbook 清单 |
| `ac action create <id>` | 快速生成新的 Action 声明模板文件 |
| `ac action list [--json]` | 列出当前项目中的所有 Action |
| `ac action show <id> [--json]` | 查看指定 Action 的详细定义与入参出参 Schema |
| `ac action run <id> --input '<json>'` | 运行 Action 并输出标准结果 JSON |
| `ac action validate` | 校验 Action 与 JSON Schema 语法合法性 |
| `ac playbook create <id>` | 快速生成新的 Playbook SOP 模板文件 |
| `ac playbook list / show <id>` | 查看任务 SOP 指南 Playbook |
| `ac config list / get / set / delete` | 查看与管理本地 SQLite 运行时配置 |
| `ac state list / get / set / delete` | 查看与管理本地 SQLite 共享状态存储 |
| `ac runs list / show <run-id>` | 查看 Action 执行历史与输入输出记录 |
| `ac test` | 使用 Bun Test Runner 执行单元测试 |
| `ac build [--target <target>] [--out <path>]` | 将项目编译为单个自包含独立二进制（支持交叉编译：`linux-x64` / `darwin-x64` / `darwin-arm64` / `windows-x64`） |
| `ac export skill [--target <target>]` | 导出包含 `SKILL.md` + 独立二进制的完整 Skill 交付包（支持分平台交叉编译） |

---

## 代码仓库分层结构

* [`packages/sdk`](packages/sdk)：`@actiondock/sdk` 极简公共 SDK（`defineAction`、核心上下文类型、`createTestRuntime` 内存测试工具），零重依赖。
* [`packages/core`](packages/core)：`@actiondock/core` 底层领域引擎（项目加载、ActionRunner 执行器、SQLite 存储管理、Ajv Schema 校验、Bun.build 单文件编译与 Skill 导出）。
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
