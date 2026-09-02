---
name: actiondock
description: 使用 ActionDock 2.0 (ac CLI, Bun + TypeScript) 进行 AI Agent Action 与 Skill 的创建、开发、测试、独立构建、多云调度与导出的完整工具链指南。
---

# ActionDock 2.0 (ac) 开发者技能指南

ActionDock 2.0 是面向 AI Agent Action 与 Skill 的开发工具链（CLI 门面命令为 `ac`）。它支持 **源码型 Skill**与**独立便携型 Skill** 双模交付，让开发者使用 TypeScript 快速开发原子工具（Action）与业务操作规程（Playbook），一键导出自包含的 Agent Skill。

---

## 环境准备与 CLI 安装

ActionDock 2.0 依赖 **Bun (>= 1.2)** 运行时环境。

### 1. 安装 Bun 运行时
```bash
npm install bun -g
```

### 2. 安装 ActionDock CLI 与 SDK

#### 方式 A：npm 全局安装（已发布状态）
```bash
npm install -g @actiondock/cli
```

#### 方式 B：本地源码开发态（未发布 npm / 实时热生效）
```bash
git clone https://github.com/team4u/actiondock.git
cd actiondock
bun install

# 1. 注册全局 ac CLI 命令
cd packages/cli && bun link

# 2. 注册全局 @actiondock/sdk 依赖
cd ../sdk && bun link
```
> [!NOTE]
> 全局 link 是一次性操作。后续在各个 Action 项目内执行 `bun link @actiondock/sdk` 即可接入本地 SDK。常见安装报错见下方排查表。

### 3. 初始化新 Action 项目
```bash
ac init [directory] --id <package-id> --name <display-name> --desc <description>
cd [directory]

# SDK 已发布 npm 时：
bun install

# SDK 未发布 npm（当前开发态，404 即此情况）：
bun link @actiondock/sdk   # 接入本地全局 SDK 并自动补齐其余依赖
```
自动生成包含 `actiondock.json`、`package.json`、`tsconfig.json`、`actions/`、`playbooks/` 与 `tests/` 的完整工程骨架。

### 依赖安装与故障排查

| 症状 / 报错 | 根本原因 | 解决办法 |
| :--- | :--- | :--- |
| `GET .../@actiondock%2fsdk - 404` | SDK 尚未发布至 npm | 在 SDK 源码目录执行 `bun link`，随后在项目内执行 `bun link @actiondock/sdk` |
| `SELF_SIGNED_CERT_IN_CHAIN` | 公司内网代理或自签 CA 证书 | 临时加前缀 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或配置 `bun config set cafile <CA路径>` |
| 清理 `node_modules` 后再次 404 | link 依赖不会写入 `bun.lock` | 项目内重新执行 `bun link @actiondock/sdk` 恢复链接 |

#### Link 三原则（Agent 必读）：
1. **契约原则**：`package.json` 永远声明 `"@actiondock/sdk": "^2.0.0"`，**严禁**改为 `link:` 或本地相对路径（保证跨机器与独立构建一致性）。
2. **分层原则**：SDK 源码根目录 `bun link` 全局执行一次；各 Action 项目内 `bun link @actiondock/sdk` 每项目执行一次。
3. **双 Link 区分**：`ac link` 是 **ActionDock 全局包与工作区注册**（支持跨目录 `ac run pkg/action`，支持单包或工作区一键挂载并动态感知子包），`bun link` 是 **TypeScript/Node 依赖解析**，两者职责独立，开发态通常都需要执行。

### 核心指引：能力发现与模糊探索（Agent 操作首选）

> [!IMPORTANT]
> **Agent 关键行动指引**：当用户需要进行某项业务操作、探索系统可用能力，或不确定有哪些 Package / Action / Playbook 适合当前任务时，**务必优先使用 `ac info <patterns...>` 或 `ac info -i <pattern>` 进行意图模糊搜索**！
> - **先查后用**：先通过模糊搜索查看当前环境（本地项目、全局 Linked Packages 或远程 Profile）中有哪些工具组件最契合任务。
> - **智能决议机制**：
>   - **唯一命中**：若搜索词唯一定位到某个 Package（如 `ac info browser`），直接自动展开并输出该包的完整详细元数据、所有 Actions 清单、Playbooks 规程及配置 Schema。
>   - **多项命中**：若搜索词匹配到多个 Package（如 `ac info ops`），输出过滤后的包摘要清单与 Actions/Playbooks 数量，供进一步通过 `ac info <package-id>` 精确定位。
>   - **未命中降级**：若未匹配到任何包，默认自动回退展示全部已注册包（配合 `--no-fallback` 可严格校验）。

```bash
# 1. 意图模糊探索（支持多关键词 / 正则）：探索可用工具与包
ac info browser                       # 模糊搜索包含 browser 的包（唯一匹配直接展开详情）
ac info github issue                  # 多关键词 OR 模糊匹配
ac info -i "github|gitlab"            # 正则意图过滤
ac info -i "nonexistent" --no-fallback # 严格匹配（未命中时非零退出）

# 2. 精确项目、已注册包或物理路径查看
ac info                               # 当前项目内：展示当前包详情；项目外：展示全部已注册包概览
ac info --tree [--json]               # 树形层级查看所有已挂载 Workspace 与子包结构
ac info <package-id> [--json]         # 精确 Package ID（如 team4u.github-tools）
ac info -P <package-id> [--json]      # 显式 -P 参数（支持包 ID 或物理文件路径）
ac info ./examples/github-tools       # 物理相对/绝对路径

# 3. 远程云端节点能力探索
ac info --profile <profile-name> [--json]       # 查看远程节点元数据与 Actions
ac info --profile <profile-name> -i "sync"      # 远程节点能力模糊过滤
ac info --server <url> --token <token> [--json]
```

### 系统体检与环境诊断 (ac doctor)
> [!NOTE]
> `ac doctor` 用于一键检查当前 Bun 运行时版本、全局 CLI PATH 状态、全局持久化数据库读写、注册表健康度（失效软链检测）以及当前项目的 Action/Playbook/Config 依赖完整性。

```bash
ac doctor                      # 运行全套系统与当前项目健康检查
ac doctor -P <package-id>      # 诊断指定 Action Package 的配置与依赖就绪状态
ac doctor --json               # 输出机器可读的诊断报告（Agent 适用）
```

### 全局包与工作区注册与解绑 (ActionDock 路由表)
> [!NOTE]
> `ac link` 负责将当前 Package 或包含多个子包的工作区（Workspace）注册到 ActionDock 全局路由表中，以便跨目录通过 `ac run <pkg>/<action>` 调度；它**不负责** `node_modules` 的代码依赖，依赖请使用 `bun link`。
> - **单包注册（智能默认）**：在 Action Package 目录下执行，自动注册当前单包。
> - **工作区挂载与子项目自动感知（智能默认）**：在包含多个子包的目录（如 `examples/`、`packages/` 或 Monorepo 根目录）执行 `ac link [path]`，自动批量扫描所有子包并挂载为 Workspace；后续工作区内新增子包**无需重新 link**，全局路由与 `ac info` 自动动态感知。
> - **`-r, --recursive` 强制递归**：当当前根目录本身已是一个 Action Package，但子目录下仍嵌套了其他独立子包时，使用 `-r` 强制深度遍历所有嵌套子包并统一注册为 Workspace。
> - **树形查看与失效清理**：通过 `ac info --tree` 查看注册表树形层级；通过 `ac unlink --prune`（或 `ac unlink -p`）一键清理已删除的失效路径。

```bash
ac link [path]                     # 智能注册：单包目录注册单包，多包目录自动扫描并挂载 Workspace
ac link [path] -r, --recursive     # 强制递归：在包内嵌套子包的复杂结构下强制深度扫描并挂载
ac unlink [id|path]                # 从全局注册表中移除指定包或工作区
ac unlink --prune                  # 自动扫描并清理本地已失效/不存在的幽灵路径（或 ac unlink -p）
```

### 跨目录包目标参数 (`-P, --package`)

ActionDock 支持多包协作开发与跨目录全局调度。当开发者或 AI Agent 在任意工作目录下工作时，**无需反复 `cd` 切换目录**，通过 `-P, --package <id|path>` 参数即可精确指定目标 Action Package：

| 命令分类 | 跨包使用示例 (`-P`) | 说明 |
| :--- | :--- | :--- |
| **元数据检查** | `ac info -P team4u.github-tools` | 查看指定包的元数据、Actions、Playbooks 与 Config Schema |
| **配置读写** | `ac config get GITHUB_TOKEN -P team4u.github-tools`<br>`ac config set GITHUB_TOKEN "ghp_xxx" -P team4u.github-tools` | 读写指定包的项目级配置（`.actiondock/runtime.db`） |
| **状态持久化** | `ac state list -P team4u.github-tools`<br>`ac state get auth:session -P team4u.github-tools` | 读写与清空指定包的持久化状态存储 |
| **运行历史** | `ac runs list -P team4u.github-tools`<br>`ac runs show <id> -P team4u.github-tools` | 查询过滤指定包的执行历史与链路详情 |
| **独立构建** | `ac build -P team4u.github-tools -o ./dist/github-tools` | 从任意外部目录一键将指定包编译为独立可执行程序 |
| **Skill 导出** | `ac export skill -P team4u.github-tools -o ./dist/skill` | 从任意外部目录一键将指定包导出为 Agent Skill 交付包 |
| **Action 调度** | `ac run team4u.github-tools/github.get-pr --input '...'` | 通过 Package-Qualified ID 直接跨包调用 Action |

> [!TIP]
> **`-P` 参数值解析机制（按优先级匹配）**：
> 1. **已注册 Package ID**：如完整 ID `team4u.github-tools` 或短 ID `github-tools`（通过 `ac link` 注册在 `~/.actiondock/registry.json` 中）。
> 2. **物理文件路径**：如相对路径 `../examples/github-tools` 或绝对路径 `/root/code/sui-tools`。

---

## Action 创建与编写规范

### 脚手架创建 Action
```bash
ac action create <action-id> --desc "Action 功能描述" [--file <filename.ts>]
```

### Action 定义结构
每个 Action 放置于 `actions/<name>.ts` 中，使用 `@actiondock/sdk` 的 `defineAction` 声明：

```ts
import { defineAction } from "@actiondock/sdk";

export interface Input {
  repo: string;
  maxCount?: number;
}

export interface Output {
  items: Array<{ id: string; title: string }>;
  total: number;
}

export default defineAction<Input, Output>({
  id: "github.list-issues",
  description: "获取指定 GitHub 仓库的 Issues 清单",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "仓库全名（owner/repo 格式）" },
      maxCount: { type: "number", default: 10 },
    },
    required: ["repo"],
  },

  outputSchema: {
    type: "object",
    properties: {
      items: { type: "array" },
      total: { type: "number" },
    },
    required: ["items", "total"],
  },

  async run(input, ctx) {
    // Config: 命令行覆盖 > 本地 SQLite > 环境变量 > 默认配置
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");

    // State: 跨执行持久化 Key-Value 存储（支持指定 TTL 秒数与命名空间）
    const lastSync = await ctx.state.get<string>("last_sync");
    await ctx.state.set("last_sync", new Date().toISOString(), 3600); // 1 小时后过期

    // Logger: 输出至 stderr（绝不污染 stdout 的标准 JSON 输出）
    ctx.log.info(`正在获取 ${input.repo} 的 issues`);

    // Signal: 标准 AbortSignal 取消信号（支持外部 Ctrl+C、超时及 MCP 客户端取消）
    // const res = await fetch(api, { signal: ctx.signal });

    // Action 组合: 跨 Action 组合调用（具备自动循环依赖检测、取消信号向下传播与父子 Run 级联）
    // const detail = await ctx.actions.invoke(otherAction, { ... });

    return {
      items: [],
      total: 0,
    };
  },
});
```

### 执行外部 CLI 与系统命令最佳实践 (`execCli` & `spawnDetached`)

当 Action 需调度系统外部 CLI 工具（如 `agent-browser`、`git`、`docker`、`jq` 等）时，按场景选用 `@actiondock/sdk` 导出的公共工具：

#### 场景 A：常规 CLI 执行（使用 `execCli`）
适用于一次性命令或已常驻 daemon 下的无损交互（如 `agent-browser get/click/type/snapshot`、`git status`、`docker ps` 等）：
1. **Windows 路径自动解析**：自动通过 `Bun.which("command")` 解析 `.cmd` / `.bat` / `.exe` 物理绝对路径。
2. **`Bun.spawnSync` 防管道死锁**：一次性同步排空管道，避免子进程句柄继承导致流读取挂起。
3. **超时与取消安全**：支持毫秒级 `timeout` 强杀与 `signal` (AbortSignal) 取消响应。
4. **Stdin 与原始字节流**：支持 `input` 管道写入与 `raw` 二进制字节流输出（图片/音视频）。

```typescript
import { defineAction, execCli } from "@actiondock/sdk";

export default defineAction({
  id: "browser.query",
  async run(input, ctx) {
    // 一行安全调用外部 CLI（带 5 秒超时、取消信号与耗时统计）
    const res = execCli("agent-browser", ["wait", "--timeout", "5s"], {
      cwd: process.cwd(),
      signal: ctx.signal,
      timeout: 5000,
    });

    if (res.timedOut) {
      ctx.log.warn("探测超时，执行降级分支");
      return { matched: false };
    }

    if (!res.ok) {
      ctx.log.warn(`Wait 未命中或非零退出: ${res.stderr}`);
      return { matched: false };
    }

    ctx.log.info(`执行完成，耗时: ${res.durationMs}ms`);
    return { matched: true, stdout: res.stdout };
  },
});
```

#### 场景 B：会拉起后台守护进程的命令（使用 `spawnDetached`）
当 CLI 命令首次拉起常驻后台守护进程（如 `agent-browser open` 会拉起常驻 daemon）：
- **问题根因**：若使用 `spawnSync`，后台 daemon 会继承 stderr/stdout 管道写句柄且常驻不退出，导致同步管道等待 EOF 挂满 timeout；若不等待 CLI 前端退出直接发 probe，又会并发拉起两个 daemon 导致配置冲突。
- **解决方案（三步闭环）**：
  1. **异步 fire**：stdio 全部 `ignore`，daemon 继承不到任何管道句柄；
  2. **等待 CLI 前端退出**：`await child.exited` 错开冷启动窗口，避免探测命令并发竞争；
  3. **轮询探测就绪**：通过轻量 probe 回调确认副作用生效（如 URL 稳定）后继续。

```typescript
import { defineAction, execCli, spawnDetached } from "@actiondock/sdk";

export default defineAction({
  id: "browser.login",
  async run(input: { url: string }, ctx) {
    let prevUrl = "", stableCount = 0;

    const ok = await spawnDetached({
      command: "agent-browser",
      args: ["open", input.url, "--timeout", "30s"],
      signal: ctx.signal,
      intervalMs: 400,
      timeoutMs: 30000,
      probe: async () => {
        // warm daemon 下 pipe 安全，用轻量 execCli 探测状态
        const r = execCli("agent-browser", ["get", "url"], { timeout: 5000 });
        const current = r.stdout.trim();
        if (current && current === prevUrl && current !== "about:blank") {
          return ++stableCount >= 3;
        }
        stableCount = 0;
        prevUrl = current;
        return false;
      },
    });

    if (!ok) {
      throw new Error(`页面打开超时未就绪: ${input.url}`);
    }

    return { status: "ready" };
  },
});
```

---

## @actiondock/sdk 核心 API 规范与方法签名速查

### 1. `defineAction<TInput, TOutput>(definition)`
声明一个标准 Action 定义：
```typescript
function defineAction<I = unknown, O = unknown>(definition: {
  id: string;                     // Action 唯一标识符（例如 "github.get-pr"）
  description?: string;           // 功能描述（供 LLM 发现与 MCP Tool 使用）
  inputSchema?: JsonSchema;       // 输入 JSON Schema（用于 Ajv 严格校验）
  outputSchema?: JsonSchema;      // 输出 JSON Schema（用于结果契约校验）
  run(input: I, ctx: ActionContext): Promise<O> | O; // 核心执行函数
}): ActionDefinition<I, O>;
```

### 2. `ActionContext` (`ctx`) 运行时上下文
传递给 Action `run` 方法的标准化执行上下文：

| 模块 | 方法签名 | 说明 |
| :--- | :--- | :--- |
| **`ctx.config`** | `get<T>(key: string, defaultValue?: T): T` | 读取配置（严格遵循 5 级优先级解析） |
| | `has(key: string): boolean` | 检查配置项是否存在 |
| **`ctx.state`** | `get<T>(key: string): Promise<T \| undefined>` | 读取持久化状态（未设置或过期返回 `undefined`） |
| | `set<T>(key: string, value: T, ttl?: number): Promise<void>` | 写入状态，`ttl` 单位为**秒**（可选） |
| | `delete(key: string): Promise<boolean>` | 删除指定状态键（返回是否实际删除） |
| | `clear(prefix?: string): Promise<number>` | 清空当前 scope 或指定前缀下的所有状态 |
| | `keys(prefix?: string): Promise<string[]>` | 列出所有未过期的状态键名 |
| | `scope(namespace: string): StateStore` | 获取命名空间隔离的子状态存储实例 |
| **`ctx.actions`**| `invoke<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O>` | 纯内存零开销相互调用（带防循环调用检测） |
| **`ctx.log`** | `debug / info / warn / error(msg: string, data?: unknown): void` | 结构化诊断日志，**强制定向至 stderr** |
| **`ctx.signal`** | `signal: AbortSignal` | 协作式取消信号（`signal.aborted`） |

### 3. `execCli(command, args?, options?)` 跨平台 CLI 调度
```typescript
function execCli(
  command: string,
  args?: string[],
  options?: {
    cwd?: string;                 // 工作目录（默认 process.cwd()）
    env?: Record<string, string>; // 环境变量覆盖
    signal?: AbortSignal;         // 取消信号（如 ctx.signal）
    timeout?: number;             // 毫秒超时强杀
    input?: string | Uint8Array;  // 标准输入管道灌入数据 (stdin)
    encoding?: string;            // 输出文本字符集（默认 "utf-8"，支持 "gbk"）
    throwOnError?: boolean;       // 失败时是否直接抛出 Error（默认 false）
  }
): {
  ok: boolean;                    // 是否成功退出且未超时
  exitCode: number;               // 退出码（-1 表示异常/超时/未找到）
  stdout: string;                 // 解码并 trim 后的文本输出
  stderr: string;                 // 解码并 trim 后的错误文本输出
  raw: Uint8Array;                // 原始二进制字节流（用于图片/音视频）
  timedOut?: boolean;             // 是否因超时强制终止
  durationMs: number;             // 执行耗时（毫秒）
};
```

### 4. `spawnDetached(options)` 守护进程类 CLI 异步启动与就绪探测
```typescript
function spawnDetached(options: {
  command: string;                          // 可执行命令（如 "agent-browser"）
  args?: string[];                          // 参数列表（如 ["open", url]）
  probe: () => Promise<boolean> | boolean;  // 就绪探测回调函数
  intervalMs?: number;                      // 轮询间隔（默认 400ms）
  timeoutMs?: number;                       // 总超时毫秒数（默认 30000ms）
  signal?: AbortSignal;                     // 取消信号（如 ctx.signal）
  cwd?: string;                             // 工作目录
  env?: Record<string, string>;             // 环境变量
}): Promise<boolean>;
```

### 5. `createTestRuntime(options?)` 纯内存单元测试沙箱
```typescript
function createTestRuntime(options?: {
  config?: Record<string, unknown>;     // Mock 配置键值对
  state?: Record<string, unknown>;      // 预填初始状态
  signal?: AbortSignal;                 // Mock 取消信号
}): {
  run<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O>;
  config: MemoryConfig;
  state: MemoryStateStore;
  logger: MemoryLogger;
};
```

---

## 开发、验证与运行

### 发现与模糊意图检索 Action 清单
```bash
ac action list [--json]
ac action list pr issue [--json]                      # 多关键字模糊匹配
ac action list -i "pr|issue" [--json]                 # 正则意图过滤（未命中默认回退全量）
ac action list -i "nomatch" --no-fallback [--json]    # 禁用未命中回退
ac action list --profile <profile-name> -i "<regex>"  # 远程云机器意图检索
```

### 校验 Action 语法与 Schema
```bash
ac action validate [id] [--json]
```

### 查看 Action 详情与 Schema 定义
```bash
ac action show <id> [--json]
ac action show <id> --profile <profile-name> [--json]
```

### 运行 Action（stdout 输出标准 JSON Envelope）
```bash
# 简写方式 (ac run)
ac run <id> --input '{"repo": "owner/repo"}'
ac run <package-id>/<action-id> --input '{"repo": "owner/repo"}'  # 推荐使用 Package-Qualified ID
ac run <id> --input-file ./input.json
ac run <id> --config GITHUB_TOKEN=secret_token
ac run <id> --timeout 30s                       # 设置超时自动终止（支持 500ms, 30s, 5m, 1h）

# 完整子命令方式 (ac action run)
ac action run <id> -i '{"repo": "owner/repo"}' --timeout 1m
```

标准输出格式：
```json
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}
```

> [!NOTE]
> **依赖自动管理与包管理器兼容**：若 Action 依赖了未安装的 npm 包，`ac run` 运行时会自动探测包管理器（按 `bun` -> `pnpm` -> `yarn` -> `npm` 降级链）补齐依赖并继续执行，安装日志输出至 `stderr`，确保 `stdout` 始终为纯净 JSON；同时完全兼容直接通过 `npm install` 手动安装的 `node_modules`。

---

## 多环境与远程云机器调度

### 远端云机器启动 HTTP Runner
```bash
# 本地监听（默认安全绑定 127.0.0.1:5177）
ac serve [--port 5177] [--token <secret-token>]

# 暴露给局域网或反向代理（必须配置 --token 或设置 ACTIONDOCK_TOKEN 环境变量）
ac serve --host 0.0.0.0 --token <secret-token> [--cors-origin <origin>] [--max-body 1mb]
```

### 本地管理 Profile
```bash
# 添加云节点（推荐使用 --token-env 指定环境变量名，避免明文持久化）
export ACTIONDOCK_ALIYUN_PROD_TOKEN=secret123
ac profile add aliyun-prod --server http://1.2.3.4:5177 --token-env ACTIONDOCK_ALIYUN_PROD_TOKEN --desc "阿里云生产节点"

# 列出所有已配置的 profile（默认掩码脱敏，支持 --reveal 明文显示）
ac profile list [--reveal] [--json]

# 测试云节点连通性与网络延迟
ac profile test aliyun-prod

# 切换全局默认激活的 profile
ac profile use aliyun-prod

# 查看或删除 profile
ac profile show [name] [--reveal] [--json]
ac profile rm <name>
```

### 异步长任务调度
```bash
# 提交远端异步长任务，立即返回 202 Accepted 与 runId
ac run sync-database --profile aliyun-prod --async -i '{"database": "analytics"}'

# 追踪与取消异步任务（本地与远程通用）
ac runs show <run-id> [--server http://127.0.0.1:5177 | --profile aliyun-prod]
ac runs cancel <run-id> [--server http://127.0.0.1:5177 | --profile aliyun-prod] [--reason "手动中止"]
```

---

## Model Context Protocol (MCP) 服务

ActionDock 2.0 原生支持作为 MCP 服务端运行，将项目中定义的所有 Action 自动暴露为标准 MCP Tools：

### STDIO 模式（本地 Agent / 桌面 IDE 直连）
```bash
ac mcp                                      # 默认启动当前目录 package 的 MCP STDIO 服务
ac mcp -d ./pkg-github -d ./pkg-slack       # 同时加载并暴露多个本地目录的 Action Packages
ac mcp --package github-tools,slack-tools   # 指定多个已 link 的 Package ID
ac mcp --all                                # 自动聚合全局 Registry 中所有已 link 的 Action Packages
ac mcp --timeout 30s                        # 限制单次 Tool 调用超时
```

### HTTP 模式（远程微服务 / Streamable HTTP）
```bash
# 启动 MCP HTTP 服务（默认监听 127.0.0.1:5178，端点为 /mcp）
ac mcp serve --port 5178

# 局域网/公网暴露（强制要求 Token 认证）
ac mcp serve --host 0.0.0.0 --port 5178 --token <secret-token>
```

### MCP Tasks 长任务扩展 (`io.modelcontextprotocol/tasks`)
- 异步调用：`tools/call` 传入 `execution: { mode: "async" }`，立即返回 `taskId`（等价于全局 `runId`）。
- 状态查询与取消：支持 `tasks/get`、`tasks/cancel`（直通底层 `ctx.signal`）与 `tasks/list`。

---

## Playbook 任务 SOP 规程

Playbook（`playbooks/*.md`）为 AI Agent 提供领域任务的标准操作规程。所有 Playbook 命令均支持项目内与跨包全局检索：

```bash
# 创建规程脚手架
ac playbook create <id> --desc "SOP 任务描述" --actions action-a action-b

# 列出规程（项目内列出当前包规程；项目外自动汇总所有 linked packages 规程）
ac playbook list [patterns...] [-i "<regex>"] [--json]

# 查看规程内容（自动跨本地项目与 linked packages 查找，支持 <package-id>/<playbook-id>）
ac playbook show <id> [--json]

# 校验规程语法与 Actions 引用合法性（支持当前项目或全局 linked packages）
ac playbook validate [id] [--json]
```

---

## 运行时存储管理

### 配置管理 (`ctx.config`)
```bash
# 项目级配置（在项目目录下默认写入 .actiondock/runtime.db，仅当前包生效）
ac config set <key> <value> [-P <pkg>]
ac config get <key> [-P <pkg>] [--reveal] [--json]
ac config list [patterns...] [-P <pkg>] [--json]
ac config delete <key> [-P <pkg>]
ac config schema [pkg]                                # 检查配置依赖与就绪状态

# 全局级配置（使用 -g 写入 ~/.actiondock/global.db，跨所有包共享）
ac config set -g <key> <value>
ac config get -g <key>
ac config list -g
ac config delete -g <key>
```
> [!TIP]
> **作用域规则**：`ac config set` 在项目内默认写入**项目级配置**，在项目外自动回退写入**全局配置**；加 `-g` 显式写入全局配置。读取优先级：`临时参数覆盖 > 项目级 SQLite > 全局级 SQLite > 环境变量 > 默认配置`。

### 状态管理 (`ctx.state`)
```bash
# 列出状态键（项目内列出当前包状态；外部目录自动汇总所有 linked packages 的状态键）
ac state list [prefix] [-P <pkg>] [-n "<namespace>"] [-i "<regex>"] [-d] [--json]

# 获取状态值（支持复合 Key 如 "auth:session"，或 package 前缀如 "my-pkg/auth:session"）
ac state get <key> [-P <pkg>] [-n "<namespace>"] [--json]

# 设置状态值（支持秒级 TTL 过期与命名空间）
ac state set <key> <json-value> [-P <pkg>] [-n "<namespace>"] [--ttl <seconds>]

# 删除状态
ac state delete <key> [-P <pkg>] [-n "<namespace>"] [--silent]

# 批量清理状态
ac state clear [prefix] [-P <pkg>] [-n "<namespace>"] [-a|--all]
```

### 执行历史与任务取消
```bash
# 查看调用历史（项目内查看当前包；外部目录自动聚合所有 linked packages 的最近运行记录）
ac runs list [patterns...] [-P <pkg>] [-i "<regex>"] [--action <id>] [--limit 20] [--json]

# 查看指定运行记录（自动跨本地与 linked packages 查找）
ac runs show <run-id> [-P <pkg>] [--json]
ac runs show <run-id> --profile <profile-name> [--json]       # 查询远程运行详情

# 取消远端运行中的长任务
ac runs cancel <run-id> --profile <profile-name> [--json]
```

---

## 单元测试 Action

使用 `@actiondock/sdk` 提供的 `createTestRuntime` 内存测试运行时：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("my-action", () => {
  it("使用 Mock 配置、状态与取消信号正常执行", async () => {
    const controller = new AbortController();
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token" },
      state: { last_sync: "2026-01-01" },
      signal: controller.signal,
    });

    const res = await runtime.run(myAction, { repo: "test/repo" });
    expect(res.total).toBe(0);
    expect(await runtime.state.get("last_sync")).toBeDefined();
  });
});
```

执行测试：
```bash
ac test
```

---

## 构建与 Skill 导出

### 构建独立可执行文件 (`ac build`)
```bash
# 全量构建：打包当前或指定包的全部 Action 为独立二进制（支持 -P 跨目录构建）
ac build [-P <package-id>] [--target <target>] [--out <path>] [--no-minify] [--no-bytecode]

# 按需构建：仅将指定 Action 编译进独立二进制
ac build [-P <package-id>] --actions github.get-pr github.review-pr
```

### 导出 Skill 交付包 (`ac export skill`)

ActionDock 提供清晰的两种分发形态（均支持 `-P, --package <id>` 跨目录导出）：

#### A. 源码型 Skill (Source Skill，默认推荐)
```bash
# 全量导出源码 Skill（当前包或指定 package-id）
ac export skill [-P <package-id>] [-o <path>] [-z]

# 任务驱动按需裁剪导出（仅包含指定 Playbook 及其依赖的 actions *.ts 文件）
ac export skill [-P <package-id>] --playbook review-pr
```
导出的源码型 Skill 目录结构：
```text
dist/<package>-skill/
├── SKILL.md                  # 面向 AI Agent 的调用说明（包含 ac link 与 Package-Qualified ID 指引）
├── actiondock.json          # Package 清单与运行时配置
├── package.json             # 依赖声明（@actiondock/sdk）
├── tsconfig.json            # TypeScript 配置（可选）
├── actions/                 # TypeScript Action 源码
│   └── review-pr.ts
└── playbooks/                # 任务 SOP Markdown 引导文档
    └── review-pr.md
```

#### B. 独立便携型 Skill (Standalone Skill，`--standalone`)
```bash
# 导出包含预构建单文件二进制的便携 Skill
ac export skill --standalone [--target linux-x64] [-o <path>] [-z]
```
导出的独立型 Skill 目录结构：
```text
dist/<package>-skill/
├── SKILL.md                  # 面向 AI Agent 的调用说明（指向 ./bin/<package>）
├── actiondock.skill.json     # 机器可读的 Skill 清单（全量 JSON Schema）
├── playbooks/                # 任务 SOP Markdown 引导文档
│   └── review-pr.md
└── bin/
    └── <package>             # 零安装独立可执行文件（预编译二进制）
```

---

## Agent 接入与使用约定

### AI Agent 调用 Source Skill 流程规范：
1. **探索与匹配能力（首选第一步）**：
   - 当接到任务或用户指令时，首先通过 `ac info <intent>`（如 `ac info github`）模糊搜索匹配的 Package 与 Action 工具。
2. **解析 Skill 根目录**：将 `SKILL.md` 所在目录解析为 `<skill_root>`。
3. **幂等注册**：执行 `ac link "<skill_root>"`（可安全重复执行）。
4. **调用 Action**：始终使用 **Package-Qualified ID** 避免冲突：
   ```bash
   ac run <package-id>/<action-id> --input '<json>'
   ```
5. **免注册直接执行** (备选)：
   ```bash
   cd <skill_root> && ac run <action-id> --input '<json>'
   ```

---

## Agent 开发核心红线

- **通道隔离原则**：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至 `stderr`），确保 `stdout` 仅输出标准 JSON Envelope。
- **严格 Schema 原则**：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`。
- **响应式取消原则**：对于网络 I/O 与耗时循环，始终绑定并检测 `ctx.signal`。
- **统一命名空间**：多 Package 交互时，Action 引用必须采用 `<package-id>/<action-id>`。
