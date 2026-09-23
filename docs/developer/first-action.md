# Action 核心模型与开发指南

Action 是 ActionDock 体系中最基础的原子能力单元。

它封装了一个具体的、确定性的任务（如查询数据库、调用外部接口、处理文本、执行受管外部命令等），并通过强类型与模式规范严格约束其输入和输出。本文档系统介绍 Action 的契约设计理念、`ActionContext` 上下文能力认知分层，以及基于单一事实源的端到端业务开发流程。

---

## Action 定义契约与单一事实源

在 ActionDock 2.x 中，`actiondock.json` 是元数据与契约模式的唯一事实源。每个 Action 的标识、描述、模式校验及依赖均在清单中声明，源码专注于纯粹的业务执行逻辑。

### 标准类型驱动开发路径

为避免模式定义与本地类型的重复编写，ActionDock 建立了从清单到代码的单向数据流与单一事实源开发闭环：

- 脚手架快速起步：执行 `ad action create <id> --input ... --output ...` 命令快速生成初始源码与基础清单条目。
- 清单声明契约：在 `actiondock.json` 的 `actions` 字典中完善 Action 输入与输出的完整 JSON Schema 模式规范（支持字段描述、枚举、嵌套结构与范围约束）。
- 自动生成类型：执行 `ad generate types` 命令行指令，工具链自动将模式规范编译为强类型的 TypeScript 声明文件 `.actiondock/generated/actions.d.ts`。
- 导入类型开发：在业务源码中导入 `ActionInput<"action-id">` 与 `ActionOutput<"action-id">` 泛型工具类型，直接约束业务执行函数，彻底消除重复手写接口的冗余。

### 动作声明形式

使用 `@actiondock/sdk` 的 `defineAction` 声明业务执行函数，配合生成的类型定义实现端到端强类型约束。

函数式声明（推荐）：

```ts
import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

export default defineAction<ActionInput<"example.greet">, ActionOutput<"example.greet">>(
  async (input, ctx) => {
    return {
      message: `Hello, ${input.name}!`,
    };
  }
);
```

对象式声明：

```ts
import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

export default defineAction<ActionInput<"example.greet">, ActionOutput<"example.greet">>({
  async run(input, ctx) {
    return {
      message: `Hello, ${input.name}!`,
    };
  },
});
```

---

## ActionContext 运行时上下文能力

每次执行 Action 时，底层运行时引擎均向业务函数注入全新的 `ActionContext` 实例。为了降低认知负荷，`ActionContext` 的能力划分为高频的基础核心能力与面向复杂治理的高级深水区能力两层。

### 基础核心能力

基础核心能力覆盖约百分之九十的日常业务开发场景，涵盖分层配置读取、键值状态持久化、动作级联调用以及结构化日志记录。

- 分层配置读取 `ctx.config`：
  - 职责与机制：提供多级回退的配置读取能力。依次从运行期覆盖参数、内置 SQLite 配置存储、系统环境变量以及清单默认值中解析配置。
  - 常用方法：
    - `ctx.config.get<T>(key: string): T | undefined`：读取指定配置，未设置时返回 `undefined`。
    - `ctx.config.get<T>(key: string, defaultValue: T): T`：读取指定配置，未设置时回退至指定默认值。
    - `ctx.config.has(key: string): boolean`：判断指定配置键是否存在。
  - 使用示例：
    ```ts
    const token = ctx.config.get<string>("GITHUB_TOKEN");
    const timeout = ctx.config.get<number>("TIMEOUT_MS", 5000);
    ```

- 键值状态持久化 `ctx.state`：
  - 职责与机制：提供轻量级持久化键值存储，基于当前 Action Package 命名空间进行物理隔离，支持设置存活时间自动失效。
  - 常用方法：
    - `ctx.state.get<T>(key: string): Promise<T | undefined>`：获取键对应的数据，若已过期或不存在则返回 `undefined`。
    - `ctx.state.set<T>(key: string, value: T, ttl?: number): Promise<void>`：存储键值对，可选传入秒级存活时间。
    - `ctx.state.delete(key: string): Promise<boolean>`：删除指定键名的数据。
    - `ctx.state.clear(prefix?: string): Promise<number>`：批量清空当前命名空间下的状态，支持前缀过滤。
    - `ctx.state.keys(prefix?: string): Promise<string[]>`：枚举当前命名空间下匹配前缀的状态键名。
    - `ctx.state.scope(namespace: string): StateStore`：创建具有独立二级命名空间隔离的子存储实例。
  - 使用示例：
    ```ts
    // 缓存数据，存活时间设置为 3600 秒
    await ctx.state.set(`cache:${id}`, result, 3600);
    const cached = await ctx.state.get<Result>(`cache:${id}`);
    ```

- 动作级联调度 `ctx.actions`：
  - 职责与机制：支持当前 Action 调度执行下游其他 Action，实现能力的细粒度原子化与高阶组合。底层运行时内置递归调用栈深度保护与环路死锁阻断检测。
  - 常用方法：
    - `ctx.actions.invoke<I, O>(actionId: string, input?: I): Promise<O>`：通过动作标识显式调用目标 Action 并返回类型化结果。
    - `ctx.actions(actionId: string, input?: unknown): Promise<unknown>`：直接以函数形式执行下游 Action。
  - 使用示例：
    ```ts
    const user = await ctx.actions.invoke<UserInput, UserOutput>("users.get", { id: "123" });
    ```

- 结构化日志记录 `ctx.log`：
  - 职责与机制：结构化输出业务执行日志。所有日志严格输出至标准错误流，彻底隔离标准输出流，杜绝污染 JSON 协议信封。
  - 常用方法：
    - `ctx.log.debug(message: string, data?: unknown): void`：输出调试级别日志。
    - `ctx.log.info(message: string, data?: unknown): void`：输出信息级别日志。
    - `ctx.log.warn(message: string, data?: unknown): void`：输出警告级别日志。
    - `ctx.log.error(message: string, data?: unknown): void`：输出错误级别日志。
  - 使用示例：
    ```ts
    ctx.log.info("任务已启动", { prNumber: input.prNumber });
    ```

### 高级深水区能力

高级深水区能力面向受管外部进程治理、长任务进度汇报、协作式取消协同及全流程链路追踪等系统级工程场景。

- 统一受管进程治理 `ctx.process`：
  - 职责与机制：提供跨平台受管的操作系统外部子进程生命周期治理，严禁静默衍生无管辖僵尸进程。提供短时命令一次性执行与长期常驻进程全生命周期受管治理能力。
  - 常用方法：
    - `ctx.process.run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult>`：一次性执行命令并等待退出，内置超时中断与输出缓冲区截断保护。
    - `ctx.process.start(input: ProcessStartInput, call?: CallOptions): Promise<ProcessStartResult>`：拉起长期受管进程，返回元数据快照与输出流游标。
    - `ctx.process.inspect(id: string): Promise<ProcessInfo>`：查询指定受管进程的实时状态。
    - `ctx.process.acquire(id: string, input: ProcessAcquireInput): Promise<ControlGrant>`：申请进程独占控制权令牌。
    - `ctx.process.write(id: string, input: ProcessWriteInput): Promise<OperationReceipt>`：向受管进程输入流异步写入指令。
  - 使用示例：
    ```ts
    // 一次性受管执行外部命令
    const result = await ctx.process.run({
      spec: {
        executable: "git",
        args: ["status", "--porcelain"],
        io: { mode: "pipe" },
      },
      timeoutMs: 10000,
      maxOutputBytes: 1024 * 1024,
    });
    ```

- 阶段进度报告 `ctx.progress`：
  - 职责与机制：长耗时或多步骤批处理任务通过进度报告器向调用端实时推送执行进度，便于智能体客户端或前端界面展示进度反馈与当前阶段说明。
  - 常用方法：
    - `ctx.progress.report(current: number, total?: number, message?: string): void`：汇报已完成量、总工作量与阶段说明。
  - 使用示例：
    ```ts
    ctx.progress.report(3, 10, "正在拉取文件列表");
    ```

- 协作式取消中止 `ctx.signal`：
  - 职责与机制：标准的 `AbortSignal` 信号实例。当外部调用方主动取消请求、触发超时或连接断开时，该信号置为中止态。透传给外部网络请求或异步等待流程，可立即释放系统计算资源。
  - 使用示例：
    ```ts
    const response = await fetch("https://api.github.com/data", {
      signal: ctx.signal,
    });
    ```

- 调用链路追踪元数据 `ctx.run`：
  - 职责与机制：提供全链路因果关联追踪上下文，包括当前执行标识、根调用标识与父级调用标识。通过该元数据可以精确串联级联调用的树状执行轨迹，便于排查与审计。
  - 核心属性：
    - `ctx.run.id`：当前 Action 单次执行的唯一运行标识。
    - `ctx.run.rootId`：触发该次级联调用链路的根任务运行标识。
    - `ctx.run.parentId`：直接触发本次执行的父级 Action 运行标识，根调用时缺省。
  - 使用示例：
    ```ts
    ctx.log.info("执行链路信息", {
      runId: ctx.run.id,
      rootId: ctx.run.rootId,
    });
    ```

---

## 业务 Action 实战开发

以实现 GitHub Pull Request 查询动作 `github.get-pr` 为例，体验基于单一事实源的标准开发流程。

### 脚手架初始化与清单契约深化

推荐首先使用脚手架命令生成 Action 初始代码骨架与清单基础条目：

```bash
ad action create github.get-pr -d "获取指定 GitHub 仓库的 Pull Request 详细信息" -i "repo:string, prNumber:number" -o "id:number, number:number, title:string, state:string, url:string, lastQueriedAt:string"
```

命令行参数 `--input` 与 `--output` 提供了基础类型的简写语法（支持 `string`、`number`、`boolean`、`array`、`object` 以及以问号结尾的可选标记）。

为了让智能体精准理解各个参数的语义和约束，需要在作为唯一事实源的 `actiondock.json` 中深化模式规范，补充字段描述（`description`）、取值示例（`examples`）以及必填项列表：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "my-action",
  "name": "GitHub Action Package",
  "version": "0.1.0",
  "description": "GitHub 工具集示例",
  "config": {
    "GITHUB_TOKEN": {
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "type": "string",
      "env": "GITHUB_TOKEN"
    }
  },
  "actions": {
    "github.get-pr": {
      "entry": "actions/get-pr.ts",
      "description": "获取指定 GitHub 仓库的 Pull Request 详细信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": {
            "type": "string",
            "description": "仓库全名，例如 team4u/actiondock",
            "examples": ["team4u/actiondock"]
          },
          "prNumber": {
            "type": "number",
            "description": "Pull Request 编号",
            "examples": [42]
          }
        },
        "required": ["repo", "prNumber"],
        "examples": [
          { "repo": "team4u/actiondock", "prNumber": 42 }
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "number" },
          "number": { "type": "number" },
          "title": { "type": "string" },
          "state": { "type": "string" },
          "url": { "type": "string" },
          "lastQueriedAt": { "type": "string" }
        },
        "required": ["id", "number", "title", "state", "url", "lastQueriedAt"]
      }
    }
  }
}
```

> [!TIP]
> 推荐在模式中通过 `examples` 字段提供具体取值样例，帮助智能体精准掌握参数格式与类型预期。

### 自动生成 TypeScript 类型声明

在清单中完成契约定义后，在项目根目录运行代码生成指令：

```bash
ad generate types
```

该命令读取 `actiondock.json`，在 `.actiondock/generated/actions.d.ts` 中生成强类型的 TypeScript 类型映射。生成的类型文件由 ActionDock 框架统一托管，无需手工维护。

### 导入类型并编写业务实现

在 `actions/get-pr.ts` 中直接导入 `ActionInput<"github.get-pr">` 与 `ActionOutput<"github.get-pr">`，无需手工重复定义接口：

```ts
import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

export default defineAction<
  ActionInput<"github.get-pr">,
  ActionOutput<"github.get-pr">
>(async (input, ctx) => {
  const token = ctx.config.get<string>("GITHUB_TOKEN");

  ctx.log.info(`正在查询 PR #${input.prNumber}（仓库: ${input.repo}）`);

  const res = await fetch(
    `https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}`,
    {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "User-Agent": "ActionDock-Agent",
      },
      signal: ctx.signal,
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub API 请求失败，状态码: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const now = new Date().toISOString();

  // 状态持久化记录最近一次查询时间，缓存 3600 秒
  await ctx.state.set(`last_query:${input.repo}#${input.prNumber}`, now, 3600);

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    state: data.state,
    url: data.html_url,
    lastQueriedAt: now,
  };
});
```

---

## 编写确定性单元测试

使用 `@actiondock/testing` 提供的纯内存测试运行时进行无外部依赖的确定性验证。在 `tests/get-pr.test.ts` 中编写测试用例：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import getPrAction from "../actions/get-pr.js";

describe("github.get-pr 动作测试", () => {
  it("在内存沙箱中执行成功并完成状态记录", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 9999,
          number: 1,
          title: "feat: example pull request",
          state: "open",
          html_url: "https://github.com/team4u/actiondock/pull/1",
        }),
      } as any;
    };

    try {
      const runtime = createTestRuntime({
        config: {
          GITHUB_TOKEN: "mock-test-token",
        },
      });

      const result = await runtime.run(getPrAction, {
        repo: "team4u/actiondock",
        prNumber: 1,
      });

      assert.equal(result.id, 9999);
      assert.equal(result.number, 1);
      assert.equal(result.title, "feat: example pull request");

      const record = await runtime.state.get("last_query:team4u/actiondock#1");
      assert.ok(record);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

---

## 本地执行与模式验证

- 调阅编码顾问：
  ```bash
  ad describe github.get-pr
  ```
  查看字段模式明细、Flat 编码指引与建议赋值样例展示，辅助精准传参。

- 执行静态校验：
  ```bash
  ad validate github.get-pr
  ```

- 运行测试用例：
  ```bash
  ad test
  ```

- 本地直接运行 Action：
  ```bash
  # 规范扁平参数调用（推荐）
  ad run github.get-pr -- repo=team4u/actiondock prNumber:=1

  # 复杂参数或多行文本通过文件传参（与扁平参数严格互斥）
  ad run github.get-pr --input-file input.json
  ```
  - 协议边界：`--` 分隔符作为控制平面选项（如 `--json`、`--config`、`--data-dir` 等）与数据平面（Action 入参）的协议边界。
  - 赋值操作符：`repo=team4u/actiondock` 严格保留为字符串，不执行类型猜测；`prNumber:=1` 严格解析为 JSON 格式数值，递归校验所有数值为有限数（`Number.isFinite`）。
  - 路径语法规则：命名段表示对象属性，纯数字段表示数组连续索引（从 0 开始连续编号，拒绝稀疏数组），根节点始终物化为对象，严格拒绝路径冲突（`INPUT_PATH_CONFLICT`），拦截 `__proto__`、`constructor`、`prototype` 等原型污染敏感属性。
  - 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）；未指定输入时默认为 `{}`。
  - 机器输出模式：面向智能体调用推荐使用 `--json`，当参数解析出错时输出标准错误信封并以退出码 2 退出。

标准输出默认输出原始纯文本或标准 JSON 结果信封，结构化诊断日志全部重定向至标准错误流。
