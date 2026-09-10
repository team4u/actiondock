---
name: actiondock
description: >-
  ActionDock 2.0 开发者套件与运行指南。当用户需要执行以下任务或涉及相关概念时激活此技能：
  创建、编写、修改或测试 ActionDock Action 工具（涉及 defineAction、ActionContext）；
  编写、校验或执行 Playbook 任务操作规程；
  使用或排查 ad 命令行工具（包括 ad init、ad new、ad info、ad list、ad describe、ad run、ad validate、ad generate、ad playbook、ad config、ad state、ad runs、ad serve、ad mcp、ad build、ad test、ad add、ad remove、ad pack、ad doctor、ad link、ad unlink、ad export skill、ad profile）；
  配置持久化状态与环境变量、管理全局路由注册表、执行环境体检；
  将工具构建为 Node.js 运行时交付目录、打包为 npm 压缩包或导出为 Agent Skill 资产。
  凡用户询问 ActionDock、ad 命令、@actiondock/sdk 或涉及 Agent 工具开发场景均须应用此技能。
---

# ActionDock 2.0 开发者技能指南

ActionDock 2.0 是面向 AI 智能体 Action 与 Skill 的工程化开发、测试、构建与分发工具链，命令行工具为 `ad`。
ActionDock 默认运行于 Node.js 24（要求版本大于等于 24.12.0），基于 Node 原生类型擦除与 NodeNext 模块解析。
ActionDock 采用 `actiondock.json`（规范版本号为 2）作为元数据唯一事实源，配套 `actiondock.lock.json`（规范版本号为 1）作为跨包依赖锁定事实源。
ActionDock 支持源码型与 Node.js 目录型交付形态，支持开发者使用 TypeScript 快速开发原子 Action 工具与业务 Playbook 规程，一键导出自包含的 Agent Skill 资产。

---

## 智能体场景与决策路由

当接收到具体任务时，参考下表快速索引对应的执行范式与命令：

| 业务意图与需求 | 执行范式与决策建议 | 核心命令与操作路径 |
| :--- | :--- | :--- |
| **新建工程项目** | 生成标准工程骨架，包含清单、配置、代码与规程目录 | `ad init [directory] -i <id> -n <name>` |
| **新建 Action 工具** | 脚手架生成并实现标准输入输出契约 | `ad new action <id> [-d <desc>] [-f <file>]` |
| **新建 Playbook 规程** | 脚手架生成任务操作规程 Markdown 模板 | `ad new playbook <id> [-d <desc>] [-a <actions...>]` |
| **探索可用能力** | 模糊意图检索，优先检查规程与工具清单 | `ad info <patterns...>` 或 `ad info -i <pattern>` |
| **列出可用 Action** | 按包或关键词列出已注册的所有 Action | `ad list [patterns...] [-P <pkg>]` |
| **查看 Action 详情** | 查看指定 Action 的 Schema 模式、入参要求与依赖 | `ad describe <id> [-P <pkg>]` |
| **调用原子 Action** | 执行动作逻辑，推荐通过文件传递复杂参数 | `ad run <action> --input-file <path>` |
| **异步长任务调用** | 提交异步执行任务并获取凭据，追踪执行进度与结果 | `ad run <action> --async`，结合 `ad runs` 追踪 |
| **执行复合业务任务** | 规程优先原则，阅读规程后依序调度 | `ad playbook show <id>`，依步骤调度对应 Action |
| **校验清单与契约** | 校验 Action 清单完整性与 Schema 规范有效性 | `ad validate [id] [-P <pkg>]` |
| **校验 Playbook 规程** | 校验 Playbook 引用 Action 的合法性与完整性 | `ad playbook validate [id] [-P <pkg>]` |
| **生成 TypeScript 类型** | 基于清单 Schema 自动生成强类型声明文件 | `ad generate types` |
| **安装与锁定依赖** | 声明并锁定跨包依赖，支持原子事务保护 | `ad add <package>`，更新 `actiondock.lock.json` |
| **移除外部依赖** | 从清单与锁文件中安全移除依赖包，保留数据命名空间 | `ad remove <package>` |
| **单元测试与验证** | 内存沙箱测试，验证业务逻辑与持久化状态 | `ad test [pattern]`，结合 `createTestRuntime` |
| **打包 npm 分发包** | 打包为标准 npm 压缩包用于共享与发布 | `ad pack [-P <id>] [-o <path>] [--dry-run]` |
| **构建交付目录** | 构建为 Node.js 运行时交付目录或归档 | `ad build [-P <id>] [-o <path>] [--vendor-deps]` |
| **导出 Agent Skill** | 导出源码型或 Node.js 目录型技能资产 | `ad export skill [-P <ids...>] [-m <mode>]` |
| **管理运行配置项** | 读取、设置、列出或校验项目与全局配置 | `ad config list`、`ad config get`、`ad config set` |
| **管理持久化状态** | 跨执行生命周期读写状态键与清理命名空间 | `ad state list`、`ad state get`、`ad state set` |
| **查询与取消运行历史** | 检索历史任务记录、查看执行详情或取消运行 | `ad runs list`、`ad runs show`、`ad runs cancel` |
| **配置远程执行环境** | 管理远端 Runner 服务的连接凭证与当前切换目标 | `ad profile list`、`ad profile add`、`ad profile use` |
| **启动 HTTP 服务** | 启动轻量级 HTTP 运行服务，提供 REST 与 SSE 接口 | `ad serve [-p <port>] [-H <host>] [-t <token>]` |
| **启动 MCP 协议服务** | 启动标准 Model Context Protocol 服务供智能体直连 | `ad mcp`（STDIO 模式）或 `ad mcp http` |
| **本地开发软链挂载** | 将当前包或工作区挂载到全局注册表 | `ad link [path]`、`ad unlink [id|path]` |
| **排查错误与自愈体检** | 检查挂载树、清理失效软链、执行系统体检 | `ad info --tree` -> `ad unlink --prune` -> `ad doctor` |

---

## 核心调度流：能力发现与规程优先决议

> [!IMPORTANT]
> **智能体关键行动指引**：当用户需要进行某项业务操作、探索可用工具，或不确定有哪些组件契合任务时，必须遵循以下行动准则：
> - **按需排查原则**：默认运行环境、命令行工具与依赖均已就绪，严禁在任务启动前习惯性运行安装检查或 `ad doctor` 体检；仅在实际调用报错时按需排查。
> - **先查后用原则**：首先使用 `ad info <patterns...>` 或 `ad list [patterns...]` 搜索相关包、Action 与规程。
> - **规程优先决议**：在命中目标包后，**优先检查输出中是否存在匹配的 Playbook**。若存在规程，必须执行 `ad playbook show <id>` 读取标准操作规程，依规程步骤调用 Action；严禁擅自跳过规程自行拼凑调用顺序。仅当无匹配规程或用户明确指定单点操作时，方可直接调用单一 Action。

### 意图模糊探索与包检索
```bash
# 模糊搜索（唯一匹配时直接自动展开完整包详情、Action 清单与规程列表）
ad info browser
ad info github pr

# 正则意图过滤
ad info -i "github|gitlab"

# 查看当前工作区注册树与挂载结构
ad info --tree

# 查看指定包详情（支持包标识或物理路径）
ad info <package-id>
ad info -P <package-id>
```

### Action 清单与模式检索
```bash
# 列出当前项目、已链接包或远端服务中的所有 Action
ad list

# 支持模糊意图过滤 Action
ad list github issue
ad list -i "create|update"

# 查看指定 Action 的完整描述、Schema 定义与调用依赖
ad describe github.list-issues
ad describe team4u.github-tools/list-issues
```

---

## 完整命令行工具手册

### 工程初始化与代码脚手架 (`ad init`, `ad new`)

- `ad init [directory]`：初始化新的 ActionDock 项目工程。
  - `-i, --id <id>`：指定项目唯一逻辑标识符（如 `team4u.deploy-tools`）。
  - `-n, --name <name>`：指定项目人类可读显示名称。
  - `-d, --desc <description>`：指定项目描述信息。
- `ad new action <id>`：在当前工程中脚手架生成新 Action 模板源码并在 `actiondock.json` 中注册。
  - `-d, --desc <description>`：指定 Action 描述。
  - `-f, --file <filePath>`：指定相对于动作目录的目标文件路径（默认 `<id>.ts`）。
- `ad new playbook <id>`：在当前工程中脚手架生成新 Playbook 规程并在 `actiondock.json` 中注册。
  - `-d, --desc <description>`：指定 Playbook 描述。
  - `-a, --actions <actions...>`：声明规程引用的 Action 标识符列表。
  - `-f, --file <filePath>`：指定相对于规程目录的目标 Markdown 文件路径。

### Action 契约校验与类型生成 (`ad validate`, `ad generate`)

- `ad validate [id]`：校验 Action 清单完整性与 Schema 格式规范。
  - `-P, --package <id>`：指定目标包路径或标识符。
  - 校验内容包括：Schema 合法性、必填字段存在性、引用文件物理存在性、`uses` 依赖闭包可解析性。
- `ad generate types`：根据 `actiondock.json` 中声明的 `inputSchema` 与 `outputSchema` 自动生成强类型 TypeScript 声明文件。
  - 产物输出路径为 `.actiondock/generated/actions.d.ts`。
  - 当清单变更时，运行此命令即可获得强类型开发补全。

### Action 运行与长任务追踪 (`ad run`, `ad runs`)

- `ad run <action>`：调用并执行指定 Action。
  - `-i, --input <json>`：行内传入 JSON 格式参数。
  - `-f, --input-file <path>`：从指定 JSON 文件读取输入参数（推荐复杂结构使用）。
  - `-c, --config <key=value>`：临时覆盖配置项，支持多次指定。
  - `-t, --timeout <duration>`：设置单次调用超时时长（如 `30s`、`5m`、`500ms`）。
  - `--async`：异步提交任务并立即返回凭据对象（包含 `runId`），适用于后台长周期作业。
  - `-P, --package <id>`：跨目录指定执行的目标包。
  - `-p, --profile <name>`：在指定的远端执行配置环境下执行。
  - `-s, --server <url>`：直接指定远端 HTTP Runner 地址执行。
  - `--token <token>`：远端服务认证凭证。
  - `--json` / `--envelope`：输出机器可读的标准 JSON 信封。
- `ad runs list [patterns...]`：列出历史执行记录。
  - `-a, --action <actionId>`：按 Action 标识符过滤。
  - `-n, --limit <count>`：限制返回条数（默认 20 条）。
  - `-P, --package <id>`：按包标识符过滤。
- `ad runs show <id>`：查看指定执行记录的完整细节（入参快照、返回值、报错堆栈、耗时与事件流）。
- `ad runs cancel <id>`：取消指定正在运行的异步任务（仅针对远端服务或后台执行环境）。
  - `-r, --reason <reason>`：指定取消原因。
- `ad runs clear`：清理历史运行记录。
  - `-a, --action <actionId>`：按 Action 标识符清理。

### Playbook 规程管理 (`ad playbook`)

- `ad playbook list [patterns...]`：列出当前工程或已链接包中的任务操作规程。
  - `-i, --intent <pattern>`：按意图正则过滤。
  - `-P, --package <id>`：限定目标包。
- `ad playbook show <id>`：查看规程完整 Markdown 正文内容与关联 Action 清单。
- `ad playbook validate [id]`：校验规程格式合法性，检查其引用的所有 Action 是否在本地工程或依赖包中真实存在。
- `ad playbook create <id>`：创建新规程（功能等同于 `ad new playbook <id>`）。

### 运行时配置管理 (`ad config`)

ActionDock 提供 5 级优先级配置解析（命令行参数覆盖 > 本地存储 > 环境变量 > 默认配置）：

- `ad config list [patterns...]`：列出当前包或全局的所有配置项与当前生效值（敏感项自动掩码）。
- `ad config get <key>`：获取指定配置项的解密真实值。
- `ad config set <key> [value]`：写入配置项至持久化数据库存储。
- `ad config delete <key>`：删除指定配置项。
- `ad config schema [identifier]`：查看包声明的配置需求（类型、必填性、环境变量映射及解析就绪状态）。
- `ad config env [identifier]`：输出可直接注入当前 Shell 环境的配置导出语句。

### 持久化状态管理 (`ad state`)

Action 状态在多次执行生命周期之间保持持久化，支持命名空间隔离与秒级过期存活时间（TTL）：

- `ad state list [prefix]`：列出当前命名空间或指定前缀下的所有状态项及其值。
- `ad state keys [prefix]`：仅列出所有状态键名列表。
- `ad state get <key>`：读取指定状态键的值。
- `ad state set <key> <value>`：写入状态数据。
  - `--ttl <seconds>`：设置过期存活时间（单位秒）。
- `ad state delete <key>`：删除指定状态键。
- `ad state clear`：清空当前命名空间或指定前缀下的所有状态。
  - `--prefix <prefix>`：仅清空指定前缀匹配的状态。

### 远端执行配置环境管理 (`ad profile`)

Profile 用于管理多个远端 ActionDock HTTP Runner 服务的连接信息：

- `ad profile list`：列出所有已保存的远端环境配置。
- `ad profile add <name> --server <url> [--token <token>]`：添加或更新远端环境配置。
- `ad profile use <name>`：切换当前默认执行环境。
- `ad profile show [name]`：查看指定或当前环境的详细连接参数。
- `ad profile rm <name>`：删除指定远端环境。
- `ad profile test [name]`：测试远端服务的连通性与认证有效性。

### 轻量 HTTP 服务启动 (`ad serve`)

将本地 ActionDock 项目作为轻量级微服务暴露，供远程智能体或外部系统通过 HTTP/SSE 调度：

- `ad serve`：启动 HTTP 服务。
  - `-p, --port <port>`：监听端口（默认 5177）。
  - `-H, --host <host>`：绑定主机地址（默认 127.0.0.1）。
  - `-t, --token <token>`：设置 API 认证 Token。
  - `--allow-insecure-no-auth`：允许非本地环回地址在无 Token 情况下启动（不安全）。
  - `--cors-origin <origin>`：允许的跨域来源。
  - `--max-body <size>`：允许的最大请求体积（如 `1mb`、`500kb`）。
  - `--no-mcp`：禁用内嵌在 `/mcp` 端点的 MCP 协议服务。
  - `-d, --dir <path>`：指定要托管的项目根目录。

### Model Context Protocol 适配服务 (`ad mcp`)

为 Claude Desktop、Cursor 等支持 MCP 协议的智能体宿主提供标准协议接口：

- `ad mcp`：以标准输入输出（STDIO）模式启动 MCP 服务（默认模式）。
  - `-d, --dir <path>`：指定一个或多个项目根目录。
  - `--package <package-id>`：指定暴露的一个或多个包标识符。
  - `--all`：暴露全局路由表中挂载的所有包。
  - `--timeout <duration>`：工具执行超时时间。
- `ad mcp http`：以基于 HTTP 与 Server-Sent Events（SSE）模式启动 MCP 服务。
  - `-p, --port <port>`：服务监听端口。
  - `-H, --host <host>`：绑定主机地址。
  - `-t, --token <token>`：访问令牌。

### 依赖管理与锁定文件 (`ad add`, `ad remove`)

- `ad add <package>`：安装外部 Action 包依赖。
  - 自动更新 `package.json`、`actiondock.json` 与 `actiondock.lock.json`（`lockfileVersion: 1`）。
  - 写入过程受 `.actiondock/transactions/` 原子事务保护，异常自动回滚。
- `ad remove <package>`：安全移除指定的依赖包。
  - 自动检测反向引用，若当前包的 Action 的 `uses` 声明正在引用该依赖，命令将拦截并报错。
  - 成功移除后，保留该包历史配置与状态命名空间，支持显式安全清理。

### 项目构建、打包与 Skill 导出 (`ad build`, `ad pack`, `ad export skill`)

- `ad build`：构建为 Node.js 运行时交付目录。
  - `-P, --package <id>`：指定构建目标包。
  - `-o, --out <path>`：输出目录路径。
  - `-z, --archive`：生成标准 zip 压缩归档包。
  - `--vendor-deps`：固化并物化锁定依赖至交付目录内。
  - `--require-reproducible`：可复现性构建校验。
  - `--allow-install-scripts`：允许生命周期安装脚本运行。
- `ad pack`：将 Action 包打包为标准 npm 压缩包（`.tgz`），用于发布与共享。
  - `-P, --package <id>`：指定打包目标包。
  - `-o, --out <path>`：输出压缩包目录。
  - `--dry-run`：预检打包清单与文件完整性，不实际生成文件。
- `ad export skill`：导出自包含的 Agent Skill 资产。
  - `-m, --mode <mode>`：导出模式，支持 `source`（源码型，默认）与 `node`（包含运行依赖的独立目录型）。
  - `-P, --package <ids...>`：指定导出的包。
  - `-p, --playbook <playbooks...>`：规程驱动裁剪导出，仅打包规程及其依赖的 Action 闭包。
  - `--workspace`：批量独立导出当前工作区所有子包。
  - `--bundle [name]`：多包复合套件聚合导出，融合成统一的复合工作区技能。
  - `-z, --archive`：输出为 zip 归档包。

### 全局路由注册与环境体检 (`ad link`, `ad doctor`)

- `ad link [path]`：将本地目录的 Action 包注册到全局路由注册表。
  - 支持传入工作区根目录，自动递归扫描并挂载所有子工程。
- `ad unlink [id|path]`：解除全局路由表中的包或工作区挂载。
  - `--prune`：一键自动扫描并清理所有物理路径已不存在的失效悬空软链。
- `ad doctor`：对当前运行环境、数据库完整性、路由表有效性与工程清单执行全量健康诊断。
  - `--json` / `--envelope`：输出机器可读诊断报告。

### 单元测试运行 (`ad test`)

- `ad test [pattern]`：执行当前工程单元测试。
  - 原生支持 Node.js `node:test` 测试运行器，同时兼容 `bun test`。
  - 支持传入文件或用例匹配模式执行过滤测试。

---

## Action 编写规范与上下文 API

每个 Action 的元数据与契约在 `actiondock.json` 中统一维护，业务代码在 `actions/<name>.ts` 中通过 [`defineAction`](file:///root/code/action-dock/packages/sdk/src/action.ts) 导出。

### 清单契约声明 (`actiondock.json`)

```json
{
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "2.0.0",
  "config": {
    "GITHUB_TOKEN": {
      "type": "string",
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "required": true,
      "env": "GITHUB_TOKEN"
    }
  },
  "actions": {
    "list-issues": {
      "entry": "actions/list-issues.ts",
      "description": "获取指定 GitHub 仓库的 Issues 清单",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": { "type": "string", "description": "仓库名称" },
          "maxCount": { "type": "number", "default": 10 }
        },
        "required": ["repo"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": { "type": "array" },
          "total": { "type": "number" }
        },
        "required": ["items", "total"]
      },
      "uses": ["auth-check"]
    }
  }
}
```

### Action 业务代码标准实现

```typescript
import { defineAction } from "@actiondock/sdk";

export interface Input {
  repo: string;
  maxCount?: number;
}

export interface Output {
  items: Array<{ id: string; title: string }>;
  total: number;
}

export default defineAction<Input, Output>(async (input, ctx) => {
  // 配置读取：自动遵循 5 级优先级解析
  const token = ctx.config.get<string>("GITHUB_TOKEN");

  // 状态读写：跨执行生命周期的持久化存储（支持秒级过期存活时间）
  const lastSync = await ctx.state.get<string>("last_sync");
  await ctx.state.set("last_sync", new Date().toISOString(), 3600);

  // 日志记录：输出至标准错误流，严禁调用 console.log 污染标准输出
  ctx.log.info(`正在抓取仓库数据: ${input.repo}`);

  // 进度报告：向上层调用者汇报执行进度
  ctx.progress.report(1, 10, "正在连接服务接口");

  // 协作式取消：响应外部取消信号与超时中断
  if (ctx.signal.aborted) {
    throw new Error("任务已被调用方中止");
  }

  // 受管外部进程调度（仅支持 exec 与 spawn）
  // const procRes = await ctx.process.exec("git", ["status", "--porcelain"], { cwd: process.cwd() });

  // 动作级联调用：严格仅接受动作标识符或 ActionRef，严禁传入动作定义对象
  // await ctx.actions.invoke("auth-check", { token });

  return {
    items: [],
    total: 0,
  };
});
```

### 运行时上下文方法速查表

传递给 Action 的 [`ActionContext`](file:///root/code/action-dock/packages/sdk/src/types.ts) 包含以下核心能力：

| 上下文模块 | 核心方法签名 | 职责说明 |
| :--- | :--- | :--- |
| `ctx.config` | `get<T>(key: string, defaultValue?: T): T` | 读取配置，自动遵循 5 级优先级解析 |
| | `has(key: string): boolean` | 检查指定配置项是否存在 |
| `ctx.state` | `get<T>(key: string): Promise<T \| undefined>` | 读取持久化状态数据 |
| | `set<T>(key: string, value: T, ttl?: number): Promise<void>` | 写入状态数据，`ttl` 单位为秒 |
| | `delete(key: string): Promise<boolean>` | 删除指定状态键 |
| | `clear(prefix?: string): Promise<number>` | 清空命名空间或指定前缀下的所有状态 |
| | `keys(prefix?: string): Promise<string[]>` | 列出指定前缀下的所有状态键 |
| | `scope(namespace: string): StateStore` | 派生出隔离命名的子状态存储 |
| `ctx.process` | `exec(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>` | 执行外部命令，具备超时、取消与缓冲区超限保护 |
| | `spawn(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>` | 启动外部命令进程，返回标准化结果 |
| `ctx.actions` | `invoke<I, O>(action: ActionRef \| string, input?: I): Promise<O>` | 级联调用其他 Action，严格仅接受字符串 ID 或 ActionRef |
| `ctx.log` | `info / warn / error / debug(msg: string, data?: unknown): void` | 结构化诊断日志，强制定向至标准错误流 |
| `ctx.progress` | `report(current: number, total?: number, message?: string): void` | 汇报当前执行进度 |
| `ctx.signal` | `signal: AbortSignal` | 协作式中断信号，用于长操作与耗时循环终止 |
| `ctx.run` | `{ id: string; rootId: string; parentId?: string }` | 当前执行任务追踪标识 |

---

## 单元测试编写规范

ActionDock 独立测试框架 [`@actiondock/testing`](file:///root/code/action-dock/packages/testing/src/runtime.ts) 提供了纯内存测试沙箱 `createTestRuntime`，可结合 Node 原生测试运行器进行验证：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import listIssuesAction from "../actions/list-issues.ts";

describe("github.list-issues", () => {
  it("使用模拟配置与内存状态正常执行", async () => {
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token-value" },
      state: { last_sync: "2026-01-01T00:00:00Z" },
    });

    const result = await runtime.run(listIssuesAction, {
      repo: "team4u/actiondock",
    });

    assert.equal(result.total, 0);
  });
});
```

---

## 故障排查与自愈决策表（仅遇异常时查阅）

> [!NOTE]
> 本节属于排错手册，**正常执行流程中严禁前置运行本节命令**。仅在遇到明确报错时，依循对应链路进行针对性自愈修复。

| 报错现象或错误码 | 根本原因分析 | 标准自愈修复步骤 |
| :--- | :--- | :--- |
| `ACTION_NOT_FOUND` 或找不到包 | 全局路由表中未注册该包，或挂载路径已移动失效 | 执行 `ad info --tree` 确认挂载状态；若路径失效执行 `ad unlink --prune` 清理软链，随后在包目录下重新执行 `ad link` |
| `INPUT_NOT_JSON` | 传入参数包含非有限数、循环引用或不可序列化类型 | 检查调用参数，确保传入合法的纯 JSON 数据 |
| `OUTPUT_NOT_JSON` | Action 业务返回值包含不可序列化的非 JSON 结构 | 检查 Action 代码返回值，剔除非有限数与循环引用 |
| `ACTION_INPUT_INVALID` | 输入参数未满足声明的 `inputSchema` 约束 | 执行 `ad describe <id>` 查看参数定义与必填要求，核对数据类型与字段名称 |
| `ACTION_OUTPUT_INVALID` | Action 返回的对象不匹配 `outputSchema` 约束 | 检查 Action 返回数据是否包含所有必须属性且类型匹配 |
| `INVALID_ACTION_REF` | 引用标识非法、跨包短 ID 歧义冲突，或向 invoke 传入了对象 | 使用完全限定标识符 `<pkg>/<action>`，或确保 invoke 仅传入字符串 ID 或 ActionRef |
| `UNDECLARED_ACTION_DEPENDENCY` | 调用了未在清单 uses 中声明的依赖 Action | 在 `actiondock.json` 的 `uses` 列表中添加对应 Action 声明 |
| `ACTION_CALL_CYCLE` | 级联调用发生循环成环或超深递归 | 检查调用链路，消除 Action 间的相互调用循环 |
| `ACTION_SUBRUN_LIMIT` | 子任务并发数或累计调用数超出配额 | 优化业务逻辑，避免无节制并发派生子任务 |
| `STORAGE_WORKER_EXITED` | SQLite 存储工作线程异常退出 | 查看存储日志并重启 Host 或当前命令进程 |
| `DATA_DIR_IN_USE` | 数据目录已被其他活跃进程占用锁定 | 停止冲突进程，或通过 `--data-dir <path>` 指定独立的存储目录 |
| `DATA_DIR_RECOVERY_REQUIRED` | 上次异常退出遗留未决事务或孤儿租约 | 等待旧进程完全退出后重新执行命令触发自愈接管 |
| `TARGET_PROTOCOL_UNSUPPORTED` | 远端目标服务协议大版本不匹配 | 升级本地 CLI 或远端 ActionDock 服务至相同主版本 |
| `UNSUPPORTED_BUILD_MODE` | 传入了废弃的编译选项（--target、--bytecode、--standalone） | 移除废弃参数，使用标准的 Node.js 目录构建或 `--mode node` 导出 |
| `CONFIG_VALIDATION_FAILED` | 未注入当前 Action 依赖的必填配置项 | 执行 `ad config list` 查看缺失项，通过 `ad config set <key> <val>` 补全 |
| `ACTION_TIMEOUT` | 执行时间超过预设阈值 | 优化底层调用耗时，或在调用时添加 `-t, --timeout 60s` 增大超时时间 |

---

## Agent 行动核心红线

- 规程优先原则：面对业务编排任务，必须优先检索并遵循现成的 Playbook，严禁无视既有规程擅自拼凑 Action 调度次序。
- 按需排查原则：严禁在每次任务执行前盲目进行前置环境检查、依赖重装或运行 `ad doctor` 体检；默认环境完备就绪，仅在实际遇到报错时按需修复。
- 元数据规范原则：在修改 Action 源码（包括参数模式、描述、依赖）或新增 Action 文件后，在 `actiondock.json` 中完整登记并执行 `ad validate` 确保清单与 Schema 严格匹配；需要类型提示时运行 `ad generate types`。
- 脚手架命令原则：新增 Action 工具必须使用 `ad new action <id>`，新增 Playbook 规程必须使用 `ad new playbook <id>` 或 `ad playbook create <id>`，禁止调用不存在的 `ad action create`。
- 通道隔离原则：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至标准错误流），确保标准输出仅输出标准 JSON 信封。
- 严格契约原则：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`。
- 严格调用原则：`ctx.actions.invoke` 严格仅接受动作标识符字符串或 ActionRef 引用对象，严禁传入动作定义对象或裸函数。
- 响应式取消原则：对于网络通信与耗时循环，始终绑定并检测 `ctx.signal`。
- 统一命名空间：多包交互时，Action 引用推荐采用完全限定标识符 `<package-id>/<action-id>`，避免同名短标识符歧义冲突。
- 解耦引用原则：跨工作区或跨包调用 Action 时禁止使用文件系统物理相对路径导入，必须使用逻辑标识符通过 `ctx.actions.invoke` 进行动态寻址与调用。
