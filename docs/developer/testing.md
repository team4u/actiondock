# 实践指南：单元测试与沙箱验证

ActionDock 倡导开箱即测试与确定性验证理念。在 ActionDock 2.0 中，测试基础设施由 `@actiondock/testing` 独立测试包提供，与标准 Node.js 测试框架（`node:test`、`node:assert/strict`）及 `tsx` 原生对齐，无需启动任何外部依赖、真实后台服务或真实数据库，即可在内存中完成全生命周期的精确验证。

---

## 核心测试组件

`@actiondock/testing` 包含三大确定性基础设施组件，分别用于掌控时间、拦截外部进程与隔离持久化存储。

- **时间调度**：`FakeClock`
  提供对虚拟时间和单调时间的完全控制。支持通过 `clock.monotonic()` 获取单调时间戳，通过 `clock.now()` 获取虚拟墙上时间。调用 `await clock.advance(ms)` 可以瞬间推进虚拟时间，并按预设时刻精确触发所有到期的休眠计时器，无需真实等待，彻底解决异步测试缓慢和偶发不稳定的问题。
- **进程模拟**：`MockProcessExecutor`
  遵循进程执行器契约，用于在单元测试中拦截外部命令行调用（如 `git`、`docker`、`curl` 或无头浏览器 CLI）。支持通过字符串、正则表达式或判定函数注册匹配规则，支持预设命令的输出文本、错误文本、退出码、超时标记以及取消标记，并自动记录完整的调用历史，便于进行断言检查。
- **内存存储**：`MemoryStorage`
  基于内存 SQLite 构建，提供与生产环境完全一致的配置多级解析、状态命名空间隔离、基于虚拟时钟的键值生存时间自动失效机制，以及运行记录的终态落库契约。

---

## 全功能测试运行时 `createTestRuntime`

`createTestRuntime` 深度复用内核执行引擎 `ActionRunner`，为测试提供完整的 Action 执行生命周期。

### 核心方法对比

- **直接返回结果**：`runtime.run(action, input)`
  执行指定的 Action 并直接解包返回业务数据。如果执行期间发生模式校验失败、超时、取消或业务异常，该方法会直接抛出规范化的 `ActionRuntimeError` 异常（包含错误码 `code`、描述信息 `message` 与详细信息 `details`），非常适合进行常规业务逻辑与成功路径断言。
- **返回执行信封**：`runtime.execute(action, input, options)`
  执行指定的 Action 并返回结构完整的 `ExecutionResult` 执行信封。无论成功还是失败均不抛出异常，而是返回带有 `ok: true` 及业务数据 `data`，或者带有 `ok: false` 及结构化错误对象 `error` 的信封对象，适合用于验证错误码、运行标识 `runId` 以及超时或取消控制。

### 运行时调试接口

`createTestRuntime` 创建的运行时实例暴露了丰富的调试与插桩接口：

- **配置管理器**：`runtime.config`，支持调用 `set(key, value)` 动态注入测试配置，调用 `get(key)` 读取配置，调用 `list()` 列出当前配置。
- **状态存储库**：`runtime.state`，支持调用 `get(key)`、`set(key, value, ttl)`、`keys()`、`scope(namespace)` 等方法断言和预置状态数据。
- **虚拟时钟**：`runtime.clock`，即绑定的 `FakeClock` 实例，可直接调用 `await runtime.clock.advance(ms)` 推进测试时间。
- **进程执行器**：`runtime.process`，即绑定的 `MockProcessExecutor` 实例，可注册命令规则并检查调用记录。
- **事件总线**：`runtime.events`，记录 Action 执行生命周期产生的所有事件（包含启动、进度报告、状态变更与完成事件）。

---

## 典型场景测试用例

在项目的 `tests/` 目录下，使用 `node:test` 与 `node:assert/strict` 编写测试用例。

### 输入输出模式校验测试

验证入参不符合输入模式约束时拒绝执行，以及出参不符合输出模式约束时正确报错拦截：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { ActionRuntimeError, createTestRuntime } from "@actiondock/testing";

const validateAction = defineAction({
  id: "math.divide",
  inputSchema: {
    type: "object",
    properties: {
      dividend: { type: "number" },
      divisor: { type: "number" },
    },
    required: ["dividend", "divisor"],
  },
  outputSchema: {
    type: "object",
    properties: {
      quotient: { type: "number" },
    },
    required: ["quotient"],
  },
  run(input: { dividend: number; divisor: number }) {
    return { quotient: input.dividend / input.divisor };
  },
});

describe("模式校验测试", () => {
  it("输入参数校验不通过时应当拒绝执行", async () => {
    const runtime = createTestRuntime();

    // 缺少必填参数 divisor
    const envelope = await runtime.execute(validateAction, { dividend: 10 } as any);
    assert.equal(envelope.ok, false);
    if (!envelope.ok) {
      assert.equal(envelope.error.code, "INPUT_VALIDATION_FAILED");
    }

    // 使用 runtime.run 断言抛出规范化异常
    await assert.rejects(
      async () => {
        await runtime.run(validateAction, { dividend: 10 } as any);
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.equal(err.code, "INPUT_VALIDATION_FAILED");
        return true;
      }
    );
  });
});
```

### 配置优先级与临时覆盖测试

验证在不同优先级下配置值的覆盖和回退逻辑：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime } from "@actiondock/testing";

const configAction = defineAction({
  id: "service.fetch-data",
  run(_input, ctx) {
    const endpoint = ctx.config.get<string>("ENDPOINT_URL", "https://default.api");
    const timeout = ctx.config.get<number>("TIMEOUT_MS", 3000);
    return { endpoint, timeout };
  },
});

describe("配置优先级测试", () => {
  it("支持初始配置注入与临时配置覆写", async () => {
    const runtime = createTestRuntime({
      config: {
        ENDPOINT_URL: "https://staging.api",
        TIMEOUT_MS: 5000,
      },
      configOverrides: {
        ENDPOINT_URL: "https://override.api",
      },
    });

    const result = await runtime.run(configAction, {});
    // 临时覆写优先级高于普通持久化配置
    assert.equal(result.endpoint, "https://override.api");
    // 未覆写项正常读取普通配置
    assert.equal(result.timeout, 5000);

    // 动态修改配置
    runtime.config.set("TIMEOUT_MS", 8000);
    const updated = await runtime.run(configAction, {});
    assert.equal(updated.timeout, 8000);
  });
});
```

### 状态持久化与虚拟时间失效测试

验证状态存取、命名空间隔离以及基于 `FakeClock` 瞬间推进时间的自动过期机制，无需真实等待：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime, FakeClock } from "@actiondock/testing";

const sessionAction = defineAction({
  id: "auth.create-session",
  async run(input: { userId: string }, ctx) {
    const token = `token-${input.userId}`;
    // 写入具有 10 秒生存时间的状态
    await ctx.state.set(`token:${input.userId}`, token, 10);
    return { token };
  },
});

describe("状态生命周期与失效测试", () => {
  it("虚拟时间推进使过期状态自动失效", async () => {
    const clock = new FakeClock({ now: "2026-09-01T00:00:00.000Z" });
    const runtime = createTestRuntime({ clock });

    await runtime.run(sessionAction, { userId: "user-1" });

    // 初始状态读取有效
    const tokenVal = await runtime.state.get("token:user-1");
    assert.equal(tokenVal, "token-user-1");

    // 瞬间推进虚拟时间 5 秒，尚未过期
    await runtime.clock.advance(5000);
    assert.equal(await runtime.state.get("token:user-1"), "token-user-1");

    // 再次推进 6 秒（总计 11 秒），已超出生存时间 10 秒
    await runtime.clock.advance(6000);
    assert.equal(await runtime.state.get("token:user-1"), undefined);
  });
});
```

### 超时控制与外部取消信号测试

验证执行超时中止与通过 `AbortController` 主动取消的执行行为：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime } from "@actiondock/testing";

const longRunningAction = defineAction({
  id: "job.sleep",
  async run(_input, ctx) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ finished: true }), 1000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });
  },
});

describe("超时与信号取消测试", () => {
  it("超时触发 ACTION_TIMEOUT 错误信封", async () => {
    const runtime = createTestRuntime();

    const envelope = await runtime.execute(longRunningAction, {}, { timeoutMs: 50 });
    assert.equal(envelope.ok, false);
    if (!envelope.ok) {
      assert.equal(envelope.error.code, "ACTION_TIMEOUT");
    }
  });

  it("协作式取消触发 ACTION_CANCELLED 错误信封", async () => {
    const runtime = createTestRuntime();
    const controller = new AbortController();

    setTimeout(() => {
      controller.abort();
    }, 20);

    const envelope = await runtime.execute(
      longRunningAction,
      {},
      { signal: controller.signal }
    );
    assert.equal(envelope.ok, false);
    if (!envelope.ok) {
      assert.equal(envelope.error.code, "ACTION_CANCELLED");
    }
  });
});
```

### Action 嵌套互调与环路检测测试

验证通过 `ctx.actions.invoke` 进行下游 Action 互调，以及循环调用死锁的自动检测拦截：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction, type ActionDefinition } from "@actiondock/sdk";
import { createTestRuntime } from "@actiondock/testing";

const multiplyAction = defineAction({
  id: "math.multiply",
  run(input: { a: number; b: number }) {
    return { result: input.a * input.b };
  },
});

const calculateAction = defineAction({
  id: "math.square-plus-one",
  async run(input: { val: number }, ctx) {
    // 互调下游 Action
    const mult = await ctx.actions.invoke(multiplyAction, { a: input.val, b: input.val });
    return { final: mult.result + 1 };
  },
});

describe("Action 嵌套与环路测试", () => {
  it("正常执行嵌套调用", async () => {
    const runtime = createTestRuntime({
      actions: [multiplyAction, calculateAction],
    });

    const result = await runtime.run(calculateAction, { val: 4 });
    assert.equal(result.final, 17);
  });

  it("循环调用触发 ACTION_CYCLE_DETECTED 错误", async () => {
    const runtime = createTestRuntime();

    const cycleA: ActionDefinition = defineAction({
      id: "cycle.a",
      async run(_input: unknown, ctx): Promise<unknown> {
        return ctx.actions.invoke(cycleB, {});
      },
    });

    const cycleB: ActionDefinition = defineAction({
      id: "cycle.b",
      async run(_input: unknown, ctx): Promise<unknown> {
        return ctx.actions.invoke(cycleA, {});
      },
    });

    runtime.registerAction(cycleA);
    runtime.registerAction(cycleB);

    const envelope = await runtime.execute(cycleA, {});
    assert.equal(envelope.ok, false);
    if (!envelope.ok) {
      assert.equal(envelope.error.code, "ACTION_CYCLE_DETECTED");
      assert.ok(envelope.error.message.includes("cycle.a"));
    }
  });
});
```

### 外部命令行模拟测试

验证通过 `MockProcessExecutor` 预设外部 CLI 返回结果与命令历史核查：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime } from "@actiondock/testing";

const gitStatusAction = defineAction({
  id: "vcs.git-status",
  async run(_input, ctx) {
    const proc = await ctx.process.exec("git", ["status", "--porcelain"]);
    const isClean = proc.stdout.trim() === "";
    return { isClean, raw: proc.stdout };
  },
});

describe("外部命令模拟测试", () => {
  it("匹配预设输出并记录调用历史", async () => {
    const runtime = createTestRuntime();

    // 注册模拟命令匹配规则
    runtime.process.register("git status --porcelain", {
      ok: true,
      exitCode: 0,
      stdout: "M package.json\n",
    });

    const result = await runtime.run(gitStatusAction, {});
    assert.equal(result.isClean, false);
    assert.equal(result.raw, "M package.json\n");

    // 校验执行器调用历史
    assert.equal(runtime.process.hasCalled("git"), true);
    assert.deepEqual(runtime.process.getLastCall()?.args, ["status", "--porcelain"]);
  });
});
```

---

## 执行测试套件

在项目根目录下通过标准命令执行全量单元测试：

```bash
# 执行全量测试
npm test

# 直接通过 Node.js 执行单测
node --import tsx --test tests/*.test.ts

# 指定匹配模式执行特定测试文件
node --import tsx --test tests/math*.test.ts

# 亦可通过 ActionDock 门面命令运行
ad test
```
