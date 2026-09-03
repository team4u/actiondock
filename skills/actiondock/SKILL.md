---
name: actiondock
description: >-
  ActionDock 2.0 开发者套件与运行指南。当用户需要执行以下任务或涉及相关概念时激活此技能：
  创建、编写、修改或测试 ActionDock Action 工具（涉及 defineAction、ActionContext、execCli、spawnDetached）；
  编写、校验或执行 Playbook 任务操作规程；
  使用或排查 ac 命令行工具（包括 ac info、ac run、ac build、ac export skill、ac link、ac doctor、ac test、ac mcp 等）；
  配置持久化状态与环境变量、管理全局路由注册表、执行环境体检；
  将工具构建为独立可执行文件或导出为源码型与独立便携型 Agent Skill 交付包。
  凡用户询问 ActionDock、ac 命令、@actiondock/sdk 或涉及 Agent 工具开发场景均须应用此技能。
---

# ActionDock 2.0 开发者技能指南

ActionDock 2.0 是面向 AI Agent Action 与 Skill 的工程化开发与分发工具链，命令行工具为 `ac`。
ActionDock 支持**源码型**与**独立便携型**双模交付形态，让开发者使用 TypeScript 快速开发原子工具（Action）与业务操作规程（Playbook），一键导出自包含的 Agent Skill 资产。

---

## 智能体场景与决策路由

当接收到具体任务时，参考下表快速索引对应的执行范式与命令：

| 业务意图与用户需求 | 执行范式与决策建议 | 核心命令与操作路径 |
| :--- | :--- | :--- |
| **新建工程项目** | 生成标准工程骨架，包含配置清单、代码与规程目录 | `ac init [directory] --id <id> --name <name>` |
| **探索可用能力** | 模糊意图检索，优先检查规程与工具清单 | `ac info <patterns...>` 或 `ac info -i <pattern>` |
| **执行复合业务任务** | 规程优先原则，阅读 SOP 后依序调度 | `ac playbook show <id>`，依步骤调度对应 Action |
| **调用单点原子工具** | 使用文件传参，避免终端引号转义崩溃 | `ac run <pkg>/<action> --input-file <path>` |
| **新建 Action 工具** | 脚手架生成并实现标准输入输出契约 | `ac action create <id>`，编写 `actions/<name>.ts` |
| **编排业务操作规程** | 规范编写多步骤操作引导文档 | `ac playbook create <id>`，编写 `playbooks/<id>.md` |
| **单元测试与逻辑验证** | 纯内存沙箱测试，验证多步与状态逻辑 | `ac test`，结合 `createTestRuntime` |
| **交付导出为 Skill** | 双模导出：源码型或独立预编译便携型 | `ac export skill` 或 `ac export skill --standalone` |
| **编译为独立二进制** | 全平台交叉编译为单文件独立程序 | `ac build -t <target> -o <path>` |
| **管理配置与持久化状态** | 跨包读写配置项、状态键与执行历史 | `ac config`、`ac state`、`ac runs` |
| **排查错误与自愈修复** | 按需排查：检查挂载树、清理软链、体检 | `ac info --tree` -> `ac unlink -p` -> `ac doctor` |

---

## 核心调度流：能力发现与规程优先决议

> [!IMPORTANT]
> **智能体关键行动指引**：当用户需要进行某项业务操作、探索可用工具，或不确定有哪些组件契合任务时，必须遵循以下行动准则：
> - **按需排查原则**：默认运行环境、命令行工具与依赖均已就绪，严禁在任务启动前习惯性运行安装检查或 `ac doctor` 体检；仅在实际调用报错时按需修复。
> - **先查后用原则**：首先使用 `ac info <patterns...>` 或 `ac info -i <pattern>` 模糊搜索相关包与规程。
> - **规程优先决议**：在命中目标包后，**优先检查输出中是否存在匹配的 Playbook**。若存在规程，必须执行 `ac playbook show <id>` 读取标准操作规程，依规程步骤调用 Action；严禁擅自跳过规程自行拼凑调用顺序。仅当无匹配规程或用户明确指定单点操作时，方可直接调用单一 Action。

### 意图模糊探索与包检索
```bash
# 模糊搜索（唯一匹配时直接自动展开完整包详情、Action 清单与规程列表）
ac info browser
ac info github pr

# 正则意图过滤
ac info -i "github|gitlab"

# 查看当前工作区注册树与挂载结构
ac info --tree

# 查看指定包详情（支持包 ID 或物理路径）
ac info <package-id>
ac info -P <package-id>
```

---

## Playbook 操作规程编排规范

Playbook（存放于 `playbooks/<id>.md`）是针对复合业务场景的标准操作规程（SOP）。
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

- **前置构建**：
  调用 build-image 构建部署镜像，入参传入代码版本分支与构建标签。
  若构建返回失败或超时，立即终止发布流程并报告错误。
- **服务健康探测**：
  调用 health-check 探测集群当前节点就绪情况。
  确认关键指标正常后方可推进下一阶段。
- **执行滚动更新**：
  调用 deploy-k8s 将新版本推送到集群，入参指定目标集群命名空间与副本数。
  监听发布完成状态。

## 异常回滚规程

- 若滚动更新步骤超时或返回错误，应依序调用 rollback-k8s 回退至前一稳定版本，并向运维频道发送告警。
```

### 规程命令行操作
```bash
# 列出可用规程（支持多关键词模糊检索）
ac playbook list [patterns...] [-i "<regex>"]

# 查看规程内容详情
ac playbook show <id>

# 校验规程格式与依赖 Action 合法性
ac playbook validate [id]
```

---

## Action 创建与代码开发规范

每个 Action 放置于 `actions/<name>.ts` 中，使用 `@actiondock/sdk` 导出的 [`defineAction`](file:///root/code/action-dock/packages/sdk/src/action.ts) 声明。

### 脚手架创建 Action
```bash
ac action create <action-id> --desc "功能简要描述" [--file <filename.ts>]
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
    // 1. 配置读取：命令行参数覆盖 > 本地存储 > 环境变量 > 默认配置
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const api = ctx.config.get("GITHUB_API", "https://api.github.com");

    // 2. 状态读写：跨执行生命周期的持久化存储（支持秒级过期 TTL）
    const lastSync = await ctx.state.get<string>("last_sync");
    await ctx.state.set("last_sync", new Date().toISOString(), 3600);

    // 3. 日志记录：输出至 stderr，严禁调用 console.log 污染标准输出
    ctx.log.info(`正在抓取仓库数据: ${input.repo}`);

    // 4. 协作式取消：响应外部取消信号与超时中断
    if (ctx.signal.aborted) {
      throw new Error("任务已被调用方中止");
    }

    // 5. 级联调用：内存调用其他已导入 Action（内置递归检测与取消信号传递）
    // const detail = await ctx.actions.invoke(otherAction, { ... });

    return {
      items: [],
      total: 0,
    };
  },
});
```

### 运行时上下文方法速查表

传递给 Action 的 [`ActionContext`](file:///root/code/action-dock/packages/sdk/src/context.ts) 包含以下核心能力：

| 上下文模块 | 核心方法签名 | 职责说明 |
| :--- | :--- | :--- |
| `ctx.config` | `get<T>(key: string, defaultValue?: T): T` | 读取配置，自动遵循五层优先级解析 |
| | `has(key: string): boolean` | 检查指定配置项是否存在 |
| `ctx.state` | `get<T>(key: string): Promise<T \| undefined>` | 读取持久化状态数据 |
| | `set<T>(key: string, value: T, ttl?: number): Promise<void>` | 写入状态数据，`ttl` 单位为秒 |
| | `delete(key: string): Promise<boolean>` | 删除指定状态键 |
| | `clear(prefix?: string): Promise<number>` | 清空命名空间或指定前缀下的所有状态 |
| | `scope(namespace: string): StateStore` | 派生出隔离命名的子状态存储 |
| `ctx.actions` | `invoke<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O>` | 内存级联调用其他 Action，继承取消信号与防环链 |
| `ctx.log` | `info / warn / error / debug(msg: string, data?: unknown): void` | 结构化诊断日志，强制定向至标准错误流 |
| `ctx.signal` | `signal: AbortSignal` | 协作式中断信号，用于长 I/O 与耗时循环终止 |

---

## 外部命令行进程调度最佳实践

当 Action 需要调用宿主系统外部命令（例如 `git`、`docker`、`agent-browser` 等）时，按场景选用标准调度工具：

### 常规 CLI 命令同步执行（使用 `execCli`）

适用于一次性工具或已处于常驻状态的命令：
- 自动利用 `Bun.which` 跨平台解析命令物理路径。
- 同步排空管道并断开流句柄，从根本上防止子进程句柄继承引发的管道死锁挂起。
- 内置毫秒级超时强杀与 `ctx.signal` 取消支持。

```typescript
import { defineAction, execCli } from "@actiondock/sdk";

export default defineAction({
  id: "git.check-status",
  async run(input, ctx) {
    const res = execCli("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      signal: ctx.signal,
      timeout: 10000,
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

### 会拉起后台守护进程的命令（使用 `spawnDetached`）

当命令在初次调用时会拉起常驻后台守护进程（例如 `agent-browser open`）：
- **管道隔离**：标准输入输出全部采用 `ignore`，后台守护进程继承不到任何管道句柄，杜绝同步管道永久等待 EOF。
- **冷启动解耦**：等待前端启动进程退出，避开冷启动资源竞争。
- **轮询就绪**：通过轻量探针回调轮询确认目标服务稳定就绪。

```typescript
import { defineAction, execCli, spawnDetached } from "@actiondock/sdk";

export default defineAction({
  id: "browser.open-page",
  async run(input: { url: string }, ctx) {
    let stableUrl = "", stableTimes = 0;

    const ready = await spawnDetached({
      command: "agent-browser",
      args: ["open", input.url, "--timeout", "30s"],
      signal: ctx.signal,
      intervalMs: 500,
      timeoutMs: 30000,
      probe: async () => {
        const probeRes = execCli("agent-browser", ["get", "url"], { timeout: 3000 });
        const current = probeRes.stdout.trim();
        if (current && current === stableUrl && current !== "about:blank") {
          return ++stableTimes >= 2;
        }
        stableTimes = 0;
        stableUrl = current;
        return false;
      },
    });

    if (!ready) {
      throw new Error(`浏览器页面加载超时未就绪: ${input.url}`);
    }

    return { status: "ready" };
  },
});
```

---

## Action 调试、运行与参数传递

### 参数传递健壮性建议

在通过命令行向 Action 传递复合对象参数时，直接在行内拼接 JSON 字符串极易受到宿主终端双引号与单引号转义影响。**强烈推荐使用临时文件传参**：

```bash
# 方式一（推荐）：通过临时文件传递参数（彻底规避终端转义）
cat << 'EOF' > /tmp/action-input.json
{
  "repo": "team4u/actiondock",
  "maxCount": 20
}
EOF
ac run github.list-issues --input-file /tmp/action-input.json

# 方式二：跨包使用 Package-Qualified ID 执行
ac run team4u.github-tools/github.list-issues --input-file /tmp/action-input.json

# 方式三：行内传递简单参数（仅适用于无复杂嵌套的简单场景）
ac run github.list-issues --input '{"repo":"team4u/actiondock"}'
```

### 标准输出格式与响应契约

ActionDock 保证标准输出（stdout）始终为纯净的标准 JSON Envelope，所有日志与诊断信息均输出到标准错误流（stderr）：

- **成功响应**：
  ```json
  {
    "ok": true,
    "runId": "01J...",
    "data": { ... }
  }
  ```

- **失败响应**：
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

ActionDock SDK 提供了纯内存测试沙箱 [`createTestRuntime`](file:///root/code/action-dock/packages/sdk/src/testing.ts)，无需启动真实数据库或网络环境：

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
ac test
```

---

## 构建与 Skill 导出交付

ActionDock 支持将 Action Package 一键打包分发给不同场景的智能体系统：

### 源码型 Skill 导出（默认标准交付形态）
```bash
# 全量导出当前项目为源码型 Skill
ac export skill -o ./dist/my-skill

# 跨目录指定目标包导出
ac export skill -P <package-id> -o ./dist/my-skill

# 规程驱动的裁剪导出（仅打包指定 Playbook 及其依赖的 Action 源码）
ac export skill --playbook deploy-service -o ./dist/deploy-skill
```

导出的源码型目录结构：
```text
dist/my-skill/
├── SKILL.md                  # 面向智能体的调用说明
├── actiondock.json          # Package 清单与配置定义
├── package.json             # 依赖声明
├── actions/                 # TypeScript Action 源码
└── playbooks/                # 任务 SOP 规程文件
```

### 独立便携型 Skill 导出（预编译单文件可执行产物）
```bash
# 导出包含预构建二进制文件的便携 Skill
ac export skill --standalone -o ./dist/portable-skill
```

### 独立可执行程序构建
```bash
# 编译全量 Action 为单一跨平台可执行二进制文件
ac build -o ./dist/bin/my-tools

# 交叉编译到不同操作系统与架构
ac build -t linux-x64 -o ./dist/bin/my-tools-linux
ac build -t darwin-arm64 -o ./dist/bin/my-tools-macos
ac build -t windows-x64 -o ./dist/bin/my-tools-windows.exe
```

---

## 全局路由与配置状态管理

### 跨目录包目标参数 (`-P, --package`)

在任意目录下执行命令时，通过 `-P <id|path>` 精确指定目标包，无需切换当前工作目录：

- **读取目标包配置**：`ac config get GITHUB_TOKEN -P team4u.github-tools`
- **写入目标包配置**：`ac config set GITHUB_TOKEN "ghp_xxx" -P team4u.github-tools`
- **查看目标包状态**：`ac state list -P team4u.github-tools`
- **查询目标包执行记录**：`ac runs list -P team4u.github-tools`

### 全局包挂载与工作区路由 (`ac link`)
```bash
# 在单包目录下执行，将当前包注册至全局路由表
ac link

# 在多包目录或工作区根目录下执行，自动批量扫描并挂载所有子包
ac link ./examples

# 解除包或工作区挂载
ac unlink <package-id|path>

# 一键清理所有失效或已被物理删除的挂载路径
ac unlink --prune
```

---

## 故障排查与自愈闭环（仅遇异常时按需查阅）

> [!NOTE]
> 本章节属于排障手册，**正常执行流程中严禁前置运行本节命令**。仅在遇到明确报错时，依循对应链路进行针对性自愈修复。

### 常见故障自愈决策表

| 报错现象或错误码 | 根本原因分析 | 标准自愈修复步骤 |
| :--- | :--- | :--- |
| `ACTION_NOT_FOUND` 或找不到包 | 全局路由表中未注册该包，或挂载路径已移动失效 | 执行 `ac info --tree` 确认挂载状态；若路径失效执行 `ac unlink -p` 清理幽灵软链，随后在包目录下重新执行 `ac link` |
| `INPUT_VALIDATION_FAILED` | 输入参数未满足 Action 声明的 `inputSchema` 约束 | 执行 `ac action show <id>` 查看完整的参数定义与必填字段要求，核对数据类型与字段名称 |
| `OUTPUT_VALIDATION_FAILED` | Action `run` 方法返回的对象不匹配 `outputSchema` | 检查 Action 代码返回字段是否包含所有必须属性 |
| `CONFIG_VALIDATION_FAILED` | 未注入当前 Action 依赖的必填配置项 | 执行 `ac config schema` 查看缺失的配置项，通过 `ac config set <key> <val>` 补全配置 |
| `ACTION_TIMEOUT` | 执行时间超过预设阈值 | 优化 I/O 链路，或在调用时添加 `--timeout 60s` 调大超时时间 |
| 外部 CLI 提示找不到命令 | 宿主未安装对应工具，或 PATH 未生效 | 使用绝对路径调用，或执行 `Bun.which("command")` 检查环境可执行文件完整路径 |

### 环境体检工具 (`ac doctor`)

当遭遇未知环境异常或多项命令连续失败时，执行全量体检诊断：

```bash
# 运行全套系统与项目依赖健康诊断
ac doctor

# 输出机器可读的 JSON 报告
ac doctor --json
```

### 基础开发环境初始化（全新环境冷启动参考）

仅在宿主环境完全缺少 Bun 或 ActionDock 工具链时执行一次：

```bash
# 安装 Bun 运行时
npm install -g bun

# 本地源码开发态链接 CLI 与 SDK
cd packages/cli && bun link
cd ../sdk && bun link

# Action 项目接入 SDK
cd /path/to/my-action-project
bun link @actiondock/sdk
```

---

## Agent 行动核心红线

- **规程优先原则**：面对业务编排任务，必须优先检索并遵循现成的 Playbook，严禁无视既有 SOP 规程擅自拼凑 Action 调度次序。
- **按需排查原则**：严禁在每次任务执行前盲目进行前置环境检查、依赖重装或运行 `ac doctor` 体检；默认环境完备就绪，仅在实际遇到报错时按需修复。
- **通道隔离原则**：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至 `stderr`），确保 `stdout` 仅输出标准 JSON Envelope。
- **严格 Schema 原则**：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`。
- **响应式取消原则**：对于网络 I/O 与耗时循环，始终绑定并检测 `ctx.signal`。
- **统一命名空间**：多 Package 交互时，Action 引用必须采用 `<package-id>/<action-id>`。
