---
name: actiondock
description: >-
  ActionDock 2.0 开发者套件与运行指南。当用户需要执行以下任务或涉及相关概念时激活此技能：
  创建、编写、修改或测试 ActionDock Action 工具（涉及 defineAction、ActionContext）；
  编写、校验或执行 Playbook 任务操作规程；
  使用或排查 ad 命令行工具（包括 ad init、ad info、ad list、ad describe、ad run、ad validate、ad config、ad state、ad runs、ad serve、ad mcp、ad build、ad test、ad add、ad remove、ad pack、ad doctor、ad link、ad unlink、ad export skill）；
  配置持久化状态与环境变量、管理全局路由注册表、执行环境体检；
  将工具构建为 Node.js 运行时交付目录、打包为 npm 压缩包或导出为 Agent Skill 资产。
  凡用户询问 ActionDock、ad 命令、@actiondock/sdk 或涉及 Agent 工具开发场景均须应用此技能。
---

# ActionDock 2.0 开发者技能指南

ActionDock 2.0 是面向 AI 智能体 Action 与 Skill 的工程化开发、测试、构建与分发工具链，命令行工具为 `ad`。
ActionDock 默认运行于 Node.js 24（要求版本大于等于 24.12.0），基于 Node 原生类型擦除与 NodeNext 模块解析。
ActionDock 采用 `actiondock.json`（规范版本号为 2）作为元数据唯一事实源，配套 `actiondock.lock.json` 作为依赖锁定事实源。
ActionDock 支持源码型与 Node.js 目录型交付形态，支持开发者使用 TypeScript 快速开发原子 Action 工具与业务 Playbook 规程，一键导出自包含的 Agent Skill 资产。

---

## 智能体场景与决策路由

当接收到具体任务时，参考下表快速索引对应的执行范式与命令：

| 业务意图与需求 | 执行范式与决策建议 | 核心命令与操作路径 |
| :--- | :--- | :--- |
| **新建工程项目** | 生成标准工程骨架，包含清单、配置、代码与规程目录 | `ad init [directory] --id <id> --name <name>` |
| **探索可用能力** | 模糊意图检索，优先检查规程与工具清单 | `ad info <patterns...>` 或 `ad info -i <pattern>` |
| **执行复合业务任务** | 规程优先原则，阅读规程后依序调度 | `ad playbook show <id>`，依步骤调度对应 Action |
| **调用单点原子工具** | 使用文件传参，避免终端转义问题 | `ad run <pkg>/<action> --input-file <path>` |
| **新建 Action 工具** | 脚手架生成并实现标准输入输出契约 | `ad action create <id>`，编写 `actions/<name>.ts` |
| **校验 Action 契约** | 校验清单完整性与模式规范有效性 | `ad validate [id]` |
| **编排业务操作规程** | 规范编写多步骤操作引导文档 | `ad playbook create <id>`，编写 `playbooks/<id>.md` |
| **安装与锁定依赖** | 声明并锁定跨包依赖 | `ad add <package>`，更新 `actiondock.lock.json` |
| **移除依赖** | 从清单与锁文件中安全移除依赖包 | `ad remove <package>` |
| **单元测试与逻辑验证** | 纯内存沙箱测试，验证多步与状态逻辑 | `ad test`，结合 `createTestRuntime` |
| **打包 npm 分发包** | 打包为标准 npm 压缩包用于共享与发布 | `ad pack [-P <id>] [-o <path>]` |
| **构建交付目录** | 构建为 Node.js 运行时交付目录或归档 | `ad build [-P <id>] [-o <path>] [--vendor-deps]` |
| **交付导出为 Skill** | 单包、多包或复合导出源码型或目录型技能 | `ad export skill [-P <ids...>] [-m <mode>]` |
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

Playbook 是针对复合业务场景的标准操作规程。
规程的核心职责是明确各步骤调用次序、前后置校验逻辑与数据流动，供智能体准确依循执行。

### 清单声明与编写规范

在 `actiondock.json` 中登记 Playbook 清单条目：

```json
{
  "schemaVersion": 2,
  "id": "team4u.deploy-tools",
  "playbooks": {
    "deploy-service": {
      "entry": "playbooks/deploy-service.md",
      "description": "服务自动化构建与滚动发布操作规程",
      "actions": [
        "build-image",
        "health-check",
        "deploy-k8s"
      ]
    }
  }
}
```

Playbook Markdown 文件正文（`playbooks/deploy-service.md`）：

```markdown
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

### 校验 Action 契约规范 (`ad validate`)

可通过 `ad validate` 校验清单完整性与 Schema 规范：

```bash
# 全量校验当前包或目标包的 Action 清单与 Schema 规范
ad validate

# 校验指定 Action 的契约规范
ad validate list-issues
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
  // 配置读取：命令行参数覆盖 > 本地存储 > 环境变量 > 默认配置
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

  // 动作互调：严格仅接受动作标识符或 ActionRef，严禁传入动作定义对象
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

### 动作相互调用与依赖规范

- 严格入参约束：
  - `ctx.actions.invoke` 仅接受动作标识符字符串（短标识符如 `"list-issues"`，或跨包限定标识符如 `"team4u.github-tools/list-issues"`）或 [`ActionRef`](file:///root/code/action-dock/packages/sdk/src/types.ts) 对象。
  - **严禁传入 ActionDefinition 对象或裸函数**。传入定义对象将绕过清单校验、模式校验与子运行审计，系统抛出 `INVALID_ACTION_REF` 错误。
- 依赖必须显式声明：
  - 级联调用的目标动作必须在调用方的 `actiondock.json` 的 `uses` 列表中声明。未声明的调用在执行时返回 `UNDECLARED_ACTION_DEPENDENCY` 错误。
- 循环调用与配额防护：
  - 运行时内置调用栈成环检测机制。检测到相互递归调用成环时返回 `ACTION_CALL_CYCLE` 错误。
  - 单个根任务派生的子任务数量超限时返回 `ACTION_SUBRUN_LIMIT` 错误。

---

## 外部命令行进程调度最佳实践

当 Action 需要调用宿主系统外部命令（如 `git`、`docker`、`curl` 等）时，统一使用 `ctx.process` 接口进行调度：

- 统一受管接口：仅提供 `ctx.process.exec` 与 `ctx.process.spawn`。
- 自动跨平台解析命令物理路径。
- 同步排空管道并断开流句柄，从根本上防止子进程句柄继承引发的管道死锁挂起。
- 内置毫秒级超时强杀与 `ctx.signal` 取消支持。
- 具备输出缓冲区上限保护，防止异常大输出撑爆内存。

```typescript
import { defineAction } from "@actiondock/sdk";

export default defineAction(async (input, ctx) => {
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
});
```

---

## Action 调试、运行与参数传递

### 参数传递建议

向 Action 传递复杂对象参数时，推荐使用临时文件传参，避免终端引号转义干扰：

```bash
# 推荐方式：通过临时文件传递参数
cat << 'EOF' > /tmp/action-input.json
{
  "repo": "team4u/actiondock",
  "maxCount": 20
}
EOF
ad run github.list-issues --input-file /tmp/action-input.json

# 跨包执行方式：使用完全限定标识符
ad run team4u.github-tools/github.list-issues --input-file /tmp/action-input.json

# 简易方式：行内传递简单参数
ad run github.list-issues --input '{"repo":"team4u/actiondock"}'
```

### 标准输出格式与响应契约

ActionDock 保证标准输出始终为纯净的标准 JSON 信封，所有日志与诊断信息均输出到标准错误流：

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
      "code": "INPUT_NOT_JSON",
      "message": "入参校验失败",
      "details": { ... }
    }
  }
  ```

---

## 单元测试与验证

ActionDock 提供了纯内存测试沙箱 [`createTestRuntime`](file:///root/code/action-dock/packages/sdk/src/test-runtime.ts)，可与测试套件配合进行本地验证：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/sdk";
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

执行全量测试：
```bash
ad test
```

---

## 依赖管理、构建与 Skill 导出交付

### 依赖安装与移除

```bash
# 安装并锁定依赖，更新 actiondock.json 与 actiondock.lock.json
ad add @actiondock/common-actions

# 移除指定依赖
ad remove @actiondock/common-actions
```

### npm 压缩包打包 (`ad pack`)

将 Action 包打包为标准 npm 压缩包（`.tgz`），用于分发与发布：

```bash
# 打包当前包
ad pack

# 指定输出目录与 dry-run 预览
ad pack -o ./dist/tarballs --dry-run
```

### Node.js 运行时交付目录构建 (`ad build`)

```bash
# 构建为 Node.js 可运行交付目录
ad build -o ./dist/delivery

# 固化生产依赖至输出目录
ad build -o ./dist/delivery --vendor-deps

# 生成标准 zip 归档包
ad build -o ./dist/delivery.zip --archive
```

> ActionDock 2.0 已废弃并移除了 `--target`、`--bytecode` 与单文件二进制编译选项，统一采用目录交付模式。

### Skill 导出交付 (`ad export skill`)

```bash
# 导出源码型 Skill（默认模式）
ad export skill -o ./dist/my-skill

# 导出 Node.js 目录型自包含 Skill
ad export skill -m node --vendor-deps -o ./dist/my-node-skill

# 跨目录指定目标包导出
ad export skill -P <package-id> -o ./dist/my-skill

# 规程驱动的裁剪导出（仅打包指定 Playbook 及其依赖的 Action 源码闭包）
ad export skill --playbook deploy-service -o ./dist/deploy-skill

# 批量独立导出当前工作区所有子包
ad export skill --workspace -o ./dist/skills

# 复合套件聚合导出：将多个包融合成一个统一的复合工作区技能
ad export skill -P team4u.github-tools team4u.k8s-ops --bundle devops-suite -o ./dist/devops-suite
```

---

## 全局路由与配置状态管理

### 跨目录精确目标参数 (`-P, --package`)

在任意目录下执行命令时，通过 `-P, --package <id|path>` 精确定位目标包，无需切换当前工作目录：
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
> 本节属于排错手册，**正常执行流程中严禁前置运行本节命令**。仅在遇到明确报错时，依循对应链路进行针对性自愈修复。

### 常见故障自愈决策表

| 报错现象或错误码 | 根本原因分析 | 标准自愈修复步骤 |
| :--- | :--- | :--- |
| `ACTION_NOT_FOUND` 或找不到包 | 全局路由表中未注册该包，或挂载路径已移动失效 | 执行 `ad info --tree` 确认挂载状态；若路径失效执行 `ad unlink -p` 清理软链，随后在包目录下重新执行 `ad link` |
| `INPUT_NOT_JSON` | 传入参数包含非有限数、循环引用或不可序列化类型 | 检查调用参数，确保传入合法的 JSON 纯数据 |
| `OUTPUT_NOT_JSON` | Action 业务返回值包含不可序列化的非 JSON 结构 | 检查 Action 代码返回值，剔除非有限数与循环引用 |
| `ACTION_INPUT_INVALID` | 输入参数未满足声明的 `inputSchema` 约束 | 执行 `ad describe <id>` 查看参数定义与必填要求，核对数据类型与字段名称 |
| `ACTION_OUTPUT_INVALID` | Action 返回的对象不匹配 `outputSchema` 约束 | 检查 Action 返回数据是否包含所有必须属性且类型匹配 |
| `INVALID_ACTION_REF` | 引用标识非法、短 ID 歧义冲突，或向 invoke 传入了对象 | 使用完全限定标识符，或确保 invoke 仅传入字符串 ID 或 ActionRef |
| `UNDECLARED_ACTION_DEPENDENCY` | 调用了未在清单 uses 中声明的依赖 Action | 在 `actiondock.json` 的 `uses` 中添加对应 Action 声明 |
| `ACTION_CALL_CYCLE` | 级联调用发生循环成环或超深递归 | 检查调用链路，消除 Action 间的相互调用循环 |
| `ACTION_SUBRUN_LIMIT` | 子任务并发数或累计调用数超出配额 | 优化业务逻辑，避免无节制并发派生子任务 |
| `STORAGE_WORKER_EXITED` | SQLite 存储工作线程异常退出 | 查看存储日志并重启 Host 进程 |
| `DATA_DIR_IN_USE` | 数据目录已被其他活跃进程占用锁定 | 停止冲突进程，或指定独立的 `--data-dir` |
| `UNSUPPORTED_BUILD_MODE` | 传入了废弃的编译选项（--target、--bytecode、--standalone） | 移除废弃参数，使用标准的 Node.js 目录构建或 `--mode node` 导出 |
| `CONFIG_VALIDATION_FAILED` | 未注入当前 Action 依赖的必填配置项 | 执行 `ad config list` 查看缺失项，通过 `ad config set <key> <val>` 补全 |
| `ACTION_TIMEOUT` | 执行时间超过预设阈值 | 优化底层调用耗时，或在调用时添加 `--timeout 60s` 增大超时时间 |

### 环境体检工具 (`ad doctor`)

当遭遇未知环境异常或多项命令连续失败时，执行全量体检诊断：
```bash
# 运行全套系统与项目健康诊断
ad doctor

# 输出机器可读的 JSON 报告
ad doctor --json
```

---

## Agent 行动核心红线

- 规程优先原则：面对业务编排任务，必须优先检索并遵循现成的 Playbook，严禁无视既有规程擅自拼凑 Action 调度次序。
- 按需排查原则：严禁在每次任务执行前盲目进行前置环境检查、依赖重装或运行 `ad doctor` 体检；默认环境完备就绪，仅在实际遇到报错时按需修复。
- 元数据规范原则：在修改 Action 源码（包括参数模式、描述、依赖）或新增 Action 文件后，在 `actiondock.json` 中完整登记并执行 `ad validate` 确保清单与 Schema 严格匹配。
- 通道隔离原则：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至标准错误流），确保标准输出仅输出标准 JSON 信封。
- 严格契约原则：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`。
- 严格调用原则：`ctx.actions.invoke` 严格仅接受动作标识符字符串或 ActionRef 引用对象，严禁传入动作定义对象或裸函数。
- 响应式取消原则：对于网络通信与耗时循环，始终绑定并检测 `ctx.signal`。
- 统一命名空间：多包交互时，Action 引用必须采用完全限定标识符 `<package-id>/<action-id>`。
- 解耦引用原则：跨工作区或跨包调用 Action 时禁止使用文件系统物理相对路径导入，必须使用逻辑标识符通过 `ctx.actions.invoke` 进行动态寻址与调用。
