---
name: actiondock
description: >-
  ActionDock 2.0 开发者套件与运行指南。当用户需要执行以下任务或涉及相关概念时激活此技能：
  创建、编写、修改或测试 ActionDock Action 工具（涉及 defineAction、ActionContext）；
  编写、校验或执行 Playbook 任务操作规程；
  使用或排查 ad 命令行工具（包括 ad info、ad run、ad build、ad export skill、ad link、ad doctor、ad test、ad mcp 等）；
  配置持久化状态与环境变量、管理全局路由注册表、执行环境体检；
  将工具构建为独立可执行文件或导出为源码型与独立便携型 Agent Skill 交付包。
  凡用户询问 ActionDock、ad 命令、@actiondock/sdk 或涉及 Agent 工具开发场景均须应用此技能。
---

# ActionDock 2.0 开发者技能指南

ActionDock 2.0 是面向 AI Agent Action 与 Skill 的工程化开发、测试、构建与分发工具链，命令行工具为 `ad`。
ActionDock 默认运行于 Node.js 22+ / 24 LTS 生产环境，仅在执行单文件二进制构建时按需调用外部 Bun 编译器。
ActionDock 支持**源码型**与**独立便携型**双模交付形态，让开发者使用 TypeScript 快速开发原子 Action 工具与业务 Playbook 规程，一键导出自包含的 Agent Skill 资产。

---

## 智能体场景与决策路由

当接收到具体任务时，参考下表快速索引对应的执行范式与命令：

| 业务意图与用户需求 | 执行范式与决策建议 | 核心命令与操作路径 |
| :--- | :--- | :--- |
| **新建工程项目** | 生成标准工程骨架，包含清单、配置、代码与规程目录 | `ad init [directory] --id <id> --name <name>` |
| **探索可用能力** | 模糊意图检索，优先检查规程与工具清单 | `ad info <patterns...>` 或 `ad info -i <pattern>` |
| **执行复合业务任务** | 规程优先原则，阅读规程后依序调度 | `ad playbook show <id>`，依步骤调度对应 Action |
| **调用单点原子工具** | 使用文件传参，避免终端转义问题 | `ad run <pkg>/<action> --input-file <path>` |
| **新建 Action 工具** | 脚手架生成并实现标准输入输出契约 | `ad action create <id>`，编写 `actions/<name>.ts` |
| **编排业务操作规程** | 规范编写多步骤操作引导文档 | `ad playbook create <id>`，编写 `playbooks/<id>.md` |
| **单元测试与逻辑验证** | 纯内存沙箱测试，验证多步与状态逻辑 | `ad test`，结合 `createTestRuntime` |
| **交付导出为 Skill** | 双模导出：源码型或独立预编译便携型 | `ad export skill` 或 `ad export skill --standalone` |
| **编译为独立二进制** | 全平台交叉编译为单文件独立程序 | `ad build -t <target> -o <path>` |
| **管理配置与持久化状态** | 跨包读写配置项、状态键与执行历史 | `ad config`、`ad state`、`ad runs` |
| **排查错误与自愈修复** | 按需排查：检查挂载树、清理软链、体检 | `ad info --tree` -> `ad unlink -p` -> `ad doctor` |

---

## 核心调度流：能力发现与规程优先决议

> [!IMPORTANT]
> **智能体关键行动指引**：当用户需要进行某项业务操作、探索可用工具，或不确定有哪些组件契合任务时，必须遵循以下行动准则：
> - **按需排查原则**：默认运行环境、命令行工具与依赖均已就绪，严禁在任务启动前习惯性运行安装检查或 `ad doctor` 体检；仅在实际调用报错时按需修复。
> - **先查后用原则**：首先使用 `ad info <patterns...>` 或 `ad info -i <pattern>` 模糊搜索相关包与规程。
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

---

## Playbook 操作规程编排规范

Playbook（存放于 `playbooks/<id>.md`）是针对复合业务场景的标准操作规程。
规程的核心职责是明确各步骤调用次序、前后置校验逻辑与数据流动，供智能体准确依循执行。

### 规程标准结构与编写模板

```markdown
---
id: deploy-service
description: 自动化构建服务、执行前置健康检查并完成线上滚动部署操作规程
actions:
  - build-image
  - health-check
  - deploy-k8s
---

# 服务线上发布标准操作规程

本规程指导调度 ActionDock Action 完成自动化发布链路。

## 前提条件与环境检查

- 确保项目工作区根目录下已存在配置文件。
- 必须通过项目配置注入部署环境标识。

## 操作步骤

- 前置构建：
  调用 build-image 构建部署镜像，入参传入代码版本分支与构建标签。
  若构建返回失败或超时，立即终止发布流程并报告错误。
- 服务健康探测：
  调用 health-check 探测集群当前节点就绪情况。
  确认关键指标正常后方可推进下一阶段。
- 执行滚动更新：
  调用 deploy-k8s 将新版本推送到集群，入参指定目标集群命名空间与副本数。
  监听发布完成状态。

## 异常回滚规程

- 若滚动更新步骤超时或返回错误，应依序调用 rollback-k8s 回退至前一稳定版本，并向运维频道发送告警。
```

### 跨包 Action 依赖与规程编排

当规程需要调度其他包中的 Action 时：
- **依赖声明**：在 `actions` 列表中使用完全限定标识符 `<package-id>/<action-id>`（例如 `team4u.github-tools/github.list-issues`），或在无命名冲突时使用短标识。
- **执行指引**：在规程正文中指引智能体使用完全限定标识符调用命令：`ad run <package-id>/<action-id> --input '<json>'`。
- **跨包校验**：执行 `ad playbook validate` 时，校验器会自动结合当前包与全局已链接包（通过 `ad link` 挂载）解析 Action，跨包依赖有效时将顺利通过校验，杜绝缺失警告。

### 规程命令行操作
```bash
# 列出可用规程（支持多关键词模糊检索）
ad playbook list [patterns...] [-i "<regex>"]

# 查看规程内容详情
ad playbook show <id>

# 校验规程格式与依赖 Action 合法性（支持自动跨包解析）
ad playbook validate [id]
```

---

## Action 创建与代码开发规范

每个 Action 放置于 `actions/<name>.ts` 中，使用 `@actiondock/sdk` 导出的 [`defineAction`](file:///root/code/action-dock/packages/sdk/src/action.ts) 声明。项目元数据与契约声明以 `actiondock.manifest.json` 为单一事实源。

### 脚手架创建 Action
```bash
ad action create <action-id> --desc "功能简要描述" [--file <filename.ts>]
```

### Action 契约定义与标准实现

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

export default defineAction<Input, Output>({
  id: "github.list-issues",
  description: "获取指定 GitHub 仓库的 Issues 清单",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "仓库名称（owner/repo 格式）" },
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
    // 配置读取：命令行参数覆盖 > 本地存储 > 环境变量 > 默认配置
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");

    // 状态读写：跨执行生命周期的持久化存储（支持秒级过期 TTL）
    const lastSync = await ctx.state.get<string>("last_sync");
    await ctx.state.set("last_sync", new Date().toISOString(), 3600);

    // 日志记录：输出至 stderr，严禁调用 console.log 污染标准输出
    ctx.log.info(`正在抓取仓库数据: ${input.repo}`);

    // 进度报告：向上层调用者汇报执行进度
    ctx.progress.report(1, 10, "正在连接 GitHub API");

    // 协作式取消：响应外部取消信号与超时中断
    if (ctx.signal.aborted) {
      throw new Error("任务已被调用方中止");
    }

    // 进程调度：安全调度外部命令
    // const procRes = await ctx.process.exec("git", ["status"], { cwd: process.cwd() });

    // 级联调用：内存调用其他已导入 Action（内置递归检测与取消信号传递）
    // const detail = await ctx.actions.invoke(otherAction, { ... });

    return {
      items: [],
      total: 0,
    };
  },
});
```

### 运行时上下文方法速查表

传递给 Action 的 [`ActionContext`](file:///root/code/action-dock/packages/sdk/src/types.ts) 包含以下核心能力：

| 上下文模块 | 核心方法签名 | 职责说明 |
| :--- | :--- | :--- |
| `ctx.config` | `get<T>(key: string, defaultValue?: T): T` | 读取配置，自动遵循五层优先级解析 |
| | `has(key: string): boolean` | 检查指定配置项是否存在 |
| `ctx.state` | `get<T>(key: string): Promise<T \| undefined>` | 读取持久化状态数据 |
| | `set<T>(key: string, value: T, ttl?: number): Promise<void>` | 写入状态数据，`ttl` 单位为秒 |
| | `delete(key: string): Promise<boolean>` | 删除指定状态键 |
| | `clear(prefix?: string): Promise<number>` | 清空命名空间或指定前缀下的所有状态 |
| | `keys(prefix?: string): Promise<string[]>` | 列出指定前缀下的所有状态键 |
| | `scope(namespace: string): StateStore` | 派生出隔离命名的子状态存储 |
| `ctx.process` | `exec(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>` | 执行外部命令，具备超时、取消与缓冲区超限保护 |
| | `spawnDetached(options: DetachedProcessOptions): Promise<DetachedProcessResult>` | 启动后台守护进程并探针就绪状态 |
| `ctx.actions` | `invoke<I, O>(action: ActionDefinition<I, O> \| ActionRef \| string, input?: I): Promise<O>` | 内存级联调用其他 Action，继承取消信号与防环保护 |
| `ctx.log` | `info / warn / error / debug(msg: string, data?: unknown): void` | 结构化诊断日志，强制定向至标准错误流 |
| `ctx.progress` | `report(current: number, total?: number, message?: string): void` | 汇报当前执行进度 |
| `ctx.signal` | `signal: AbortSignal` | 协作式中断信号，用于长操作与耗时循环终止 |
| `ctx.run` | `{ id: string; rootId: string; parentId?: string }` | 当前执行任务追踪标识 |

---

## 外部命令行进程调度最佳实践

当 Action 需要调用宿主系统外部命令（例如 `git`、`docker`、`curl` 等）时，统一使用 `ctx.process` 接口进行调度：

### 常规命令行命令执行（使用 `ctx.process.exec`）

适用于一次性工具或已处于常驻状态的命令：
- 自动跨平台解析命令物理路径。
- 同步排空管道并断开流句柄，从根本上防止子进程句柄继承引发的管道死锁挂起。
- 内置毫秒级超时强杀与 `ctx.signal` 取消支持。
- 具备输出缓冲区上限保护（默认 10MB），防止异常大输出撑爆内存。

```typescript
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "git.check-status",
  async run(input, ctx) {
    const res = await ctx.process.exec("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      signal: ctx.signal,
      timeoutMs: 10000,
    });

    if (res.timedOut) {
      throw new Error("Git 状态执行超时");
    }

    if (!res.ok) {
      ctx.log.warn(`Git 执行返回非零退出码: ${res.stderr}`);
      return { clean: false };
    }

    return { clean: res.stdout.trim() === "" };
  },
});
```

### 会拉起后台守护进程的命令（使用 `ctx.process.spawnDetached`）

当命令在初次调用时会拉起常驻后台守护进程：
- **管道隔离**：标准输入输出全部采用隔离模式，后台守护进程不继承主进程管道句柄，杜绝同步管道等待挂起。
- **冷启动解耦**：等待前端启动进程退出，避开冷启动资源竞争。
- **轮询就绪**：通过轻量探针回调轮询确认目标服务稳定就绪。

```typescript
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "browser.open-page",
  async run(input: { url: string }, ctx) {
    let stableUrl = "";
    let stableTimes = 0;

    const readyRes = await ctx.process.spawnDetached({
      command: "agent-browser",
      args: ["open", input.url, "--timeout", "30s"],
      signal: ctx.signal,
      probeIntervalMs: 500,
      probeTimeoutMs: 30000,
      probe: async () => {
        const probeRes = await ctx.process.exec("agent-browser", ["get", "url"], { timeoutMs: 3000 });
        const current = probeRes.stdout.trim();
        if (current && current === stableUrl && current !== "about:blank") {
          return ++stableTimes >= 2;
        }
        stableTimes = 0;
        stableUrl = current;
        return false;
      },
    });

    if (!readyRes.ready) {
      throw new Error(`浏览器页面加载超时未就绪: ${input.url}`);
    }

    return { status: "ready" };
  },
});
```

---

## Action 调试、运行与参数传递

### 参数传递健壮性建议

在通过命令行向 Action 传递复合对象参数时，直接在行内拼接 JSON 字符串极易受到宿主终端双引号与单引号转义影响。推荐使用临时文件传参：

- 推荐方式：通过临时文件传递参数（规避终端引号转义）
  ```bash
  cat << 'EOF' > /tmp/action-input.json
  {
    "repo": "team4u/actiondock",
    "maxCount": 20
  }
  EOF
  ad run github.list-issues --input-file /tmp/action-input.json
  ```

- 跨包使用方式：使用完全限定标识符执行
  ```bash
  ad run team4u.github-tools/github.list-issues --input-file /tmp/action-input.json
  ```

- 简易方式：行内传递简单参数（适用于扁平无嵌套参数）
  ```bash
  ad run github.list-issues --input '{"repo":"team4u/actiondock"}'
  ```

### 标准输出格式与响应契约

ActionDock 保证标准输出 stdout 始终为纯净的标准 JSON 信封，所有日志与诊断信息均输出到标准错误流 stderr：

- 成功响应：
  ```json
  {
    "ok": true,
    "runId": "01J...",
    "data": { ... }
  }
  ```

- 失败响应：
  ```json
  {
    "ok": false,
    "runId": "01J...",
    "error": {
      "code": "INPUT_VALIDATION_FAILED",
      "message": "入参校验失败: /repo is required",
      "details": [ ... ]
    }
  }
  ```

---

## 单元测试与验证

ActionDock 提供了纯内存测试沙箱 [`createTestRuntime`](file:///root/code/action-dock/packages/testing/src/test-runtime.ts)（在 `@actiondock/testing` 与 `@actiondock/sdk` 中均有导出），可与标准测试套件无缝配合：

```typescript
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import listIssuesAction from "../actions/list-issues";

describe("github.list-issues", () => {
  it("使用 Mock 配置与内存状态正常执行", async () => {
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token-value" },
      state: { last_sync: "2026-01-01T00:00:00Z" },
    });

    const result = await runtime.run(listIssuesAction, {
      repo: "team4u/actiondock",
    });

    expect(result.total).toBe(0);
    expect(await runtime.state.get("last_sync")).toBeDefined();
  });
});
```

执行全量测试：
```bash
ad test
```

---

## 构建与 Skill 导出交付

ActionDock 支持将 Action Package 打包分发给不同场景的智能体系统：

### 源码型 Skill 导出（默认标准交付形态）
```bash
# 全量导出当前项目为源码型 Skill
ad export skill -o ./dist/my-skill

# 跨目录指定目标包导出
ad export skill -P <package-id> -o ./dist/my-skill

# 规程驱动的裁剪导出（仅打包指定 Playbook 及其依赖的 Action 源码闭包）
ad export skill --playbook deploy-service -o ./dist/deploy-skill
```

导出的源码型目录结构：
```text
dist/my-skill/
├── SKILL.md                  # 面向智能体的调用说明文档
├── actiondock.manifest.json  # 声明式清单事实源与配置定义
├── package.json             # 依赖声明
├── actions/                 # TypeScript Action 源码
└── playbooks/                # 任务规程文件
```

### 独立便携型 Skill 导出（预编译单文件可执行产物）
```bash
# 导出包含预构建独立可执行程序的便携 Skill
ad export skill --standalone -o ./dist/portable-skill
```

### 独立可执行程序构建
```bash
# 编译全量 Action 为单一跨平台可执行二进制文件（依赖外部 Bun 编译器）
ad build -o ./dist/bin/my-tools

# 交叉编译到不同操作系统与架构
ad build -t linux-x64 -o ./dist/bin/my-tools-linux
ad build -t darwin-arm64 -o ./dist/bin/my-tools-macos
ad build -t windows-x64 -o ./dist/bin/my-tools-windows.exe
```

---

## 全局路由与配置状态管理

### 跨目录包目标参数 (`-P, --package`)

在任意目录下执行命令时，通过 `-P <id|path>` 精确指定目标包，无需切换当前工作目录：
- 读取目标包配置：`ad config get GITHUB_TOKEN -P team4u.github-tools`
- 写入目标包配置：`ad config set GITHUB_TOKEN "ghp_xxx" -P team4u.github-tools`
- 查看目标包状态：`ad state list -P team4u.github-tools`
- 查询目标包执行记录：`ad runs list -P team4u.github-tools`

### 全局包挂载与工作区路由 (`ad link`)
```bash
# 在单包目录下执行，将当前包注册至全局路由表
ad link

# 在多包目录或工作区根目录下执行，自动批量扫描并挂载所有子包
ad link ./examples

# 解除包或工作区挂载
ad unlink <package-id|path>

# 一键清理所有失效或已被物理删除的挂载路径
ad unlink --prune
```

---

## 故障排查与自愈闭环（仅遇异常时按需查阅）

> [!NOTE]
> 本章节属于排障手册，**正常执行流程中严禁前置运行本节命令**。仅在遇到明确报错时，依循对应链路进行针对性自愈修复。

### 常见故障自愈决策表

| 报错现象或错误码 | 根本原因分析 | 标准自愈修复步骤 |
| :--- | :--- | :--- |
| `ACTION_NOT_FOUND` 或找不到包 | 全局路由表中未注册该包，或挂载路径已移动失效 | 执行 `ad info --tree` 确认挂载状态；若路径失效执行 `ad unlink -p` 清理软链，随后在包目录下重新执行 `ad link` |
| `INPUT_VALIDATION_FAILED` | 输入参数未满足 Action 声明的 `inputSchema` 约束 | 执行 `ad action show <id>` 查看完整的参数定义与必填字段要求，核对数据类型与字段名称 |
| `OUTPUT_VALIDATION_FAILED` | Action `run` 方法返回的对象不匹配 `outputSchema` | 检查 Action 代码返回字段是否包含所有必须属性 |
| `CONFIG_VALIDATION_FAILED` | 未注入当前 Action 依赖的必填配置项 | 执行 `ad config list` 查看缺失的配置项，通过 `ad config set <key> <val>` 补全配置 |
| `ACTION_TIMEOUT` | 执行时间超过预设阈值 | 优化底层调用耗时，或在调用时添加 `--timeout 60s` 增大超时时间 |
| `ad` 命令行工具未找到 | 宿主未安装 ActionDock CLI，或 PATH 未生效 | 执行 `npm install -g @actiondock/cli` 或本地链接（详见下方冷启动安装指引） |
| 外部命令提示找不到 | 宿主未安装对应工具，或 PATH 未生效 | 使用绝对路径调用，或检查系统环境变量 PATH 中是否包含该可执行文件 |

### 环境体检工具 (`ad doctor`)

当遭遇未知环境异常或多项命令连续失败时，执行全量体检诊断：
```bash
# 运行全套系统与项目依赖健康诊断
ad doctor

# 输出机器可读的 JSON 报告
ad doctor --json
```

### 基础开发环境初始化（全新环境冷启动参考）

仅在宿主环境完全缺少 Node.js 或 ActionDock 工具链时执行：
- 全局安装 ActionDock 命令行工具：
  ```bash
  npm install -g @actiondock/cli
  ```

- 验证工具就绪：
  ```bash
  ad --version
  ```

- 本地贡献与源码开发模式（若在 ActionDock 源码仓库中开发）：
  ```bash
  # 本地源码开发态链接全局 CLI
  cd packages/cli && npm link

  # Action 项目接入开发态 SDK
  cd /path/to/my-action-project
  npm link @actiondock/sdk
  ```

---

## Agent 行动核心红线

- **规程优先原则**：面对业务编排任务，必须优先检索并遵循现成的 Playbook，严禁无视既有规程擅自拼凑 Action 调度次序。
- **按需排查原则**：严禁在每次任务执行前盲目进行前置环境检查、依赖重装或运行 `ad doctor` 体检；默认环境完备就绪，仅在实际遇到报错时按需修复。
- **通道隔离原则**：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至 `stderr`），确保 `stdout` 仅输出标准 JSON 信封。
- **严格契约原则**：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`。
- **响应式取消原则**：对于网络通信与耗时循环，始终绑定并检测 `ctx.signal`。
- **统一命名空间**：多包交互时，Action 引用必须采用完全限定标识符 `<package-id>/<action-id>`。
