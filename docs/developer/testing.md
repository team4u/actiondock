# 实践指南：单元测试与沙箱验证

ActionDock 倡导确定性验证。
测试设施封装在独立包 `@actiondock/testing` 中。
工具链原生对齐标准 Node.js 测试框架（`node:test`、`node:assert/strict`）与 `tsx`。
开发者无需启动外部服务或数据库，即可在内存中完成验证。

---

## 核心测试组件

`@actiondock/testing` 包含四大基础设施组件：

- **确定性时钟**：FakeClock
  控制虚拟时间与单调时间。调用 `clock.monotonic()` 获取单调时间戳。调用 `clock.now()` 获取虚拟时间。调用 `await clock.advance(ms)` 推进虚拟时间并触发到期定时任务，无需真实等待。
- **动作调用模拟**：MockActionInvoker
  拦截下游动作调用与命名绑定。支持通过 `register` 和 `registerOnce` 注入模拟响应。支持精确匹配命名绑定，捕获输入快照与执行标识，并通过内核管道校验模式与权限。
- **进程执行模拟**：MockProcessExecutor
  拦截外部命令行调用（如 `git`、`docker`、`curl`）。支持通过字符串、正则或函数注册规则。支持预设输出、错误、退出码、超时与取消标记，并记录调用历史便于校验。
- **内存存储引擎**：MemoryStorage
  基于内存构建。提供与生产一致的配置多级解析、状态命名空间隔离与 TTL 失效机制，并保证记录终态落库契约。

---

## 全功能测试运行时：createTestRuntime

`createTestRuntime` 导出自 `@actiondock/testing`。
该函数复用内核引擎 `ActionRunner`，提供完整执行生命周期。

### 核心方法说明

- **直接返回业务数据**：`runtime.run(action, input)`
  执行指定的 Action 并解包返回业务数据。若发生校验失败、超时、取消或业务错误，该方法抛出 `ActionRuntimeError`（包含 `code`、`message` 与 `details`），适合用于常规业务断言。
- **返回标准执行信封**：`runtime.execute(action, input, options)`
  执行指定的 Action 并返回 `ExecutionResult` 信封。执行无论成败均不抛出错误。成功时返回 `ok: true` 与业务数据。失败时返回 `ok: false` 与结构化错误对象。该方法适合校验错误码、执行标识 `runId` 与超时取消。

### 运行时调试与插桩接口

`createTestRuntime` 实例提供以下调试与插桩接口：

- **动作模拟器**：`runtime.actions`，即 `MockActionInvoker` 实例。支持注册模拟规则，按绑定筛选调用记录并断言输入快照。
- **配置管理器**：`runtime.config`，支持调用 `set(key, value)` 注入配置，调用 `get(key)` 读取配置，调用 `list()` 列出配置。
- **状态存储库**：`runtime.state`，支持调用 `get(key)`、`set(key, value, ttl)`、`keys()`、`scope(namespace)` 校验和预置状态。
- **确定性时钟**：`runtime.clock`，即 `FakeClock` 实例。可调用 `await runtime.clock.advance(ms)` 推进时间。
- **进程模拟器**：`runtime.process`，即 `MockProcessExecutor` 实例。可注册规则并校验调用记录。
- **存储引擎**：`runtime.storage`，即底层 `MemoryStorage` 实例。支持审查内存数据。
- **事件总线**：`runtime.events`，记录 Action 执行产生的所有事件。

---

## 典型场景测试用例

在项目的 `tests/` 目录下，使用 `node:test` 与 `node:assert/strict` 编写测试用例。

### 输入输出模式校验测试

验证入参不符合输入约束时拒绝执行，以及出参不符合输出约束时抛出错误拦截：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { ActionRuntimeError, createTestRuntime } from "@actiondock/testing";

const divideAction = defineAction({
  run(input: { dividend: number; divisor: number }) {
    return { quotient: input.dividend / input.divisor };
  },
});

describe("模式校验测试", () => {
  it("输入参数校验不通过时应当拒绝执行", async () => {
    const runtime = createTestRuntime({
      projectConfig: {
        id: "math-pkg",
        actions: {
          "math.divide": {
            entry: "actions/divide.ts",
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
          },
        },
      },
      actions: {
        "math.divide": divideAction,
      },
    });

    // 缺少必填参数 divisor
    const envelope = await runtime.execute("math.divide", { dividend: 10 } as any);
    assert.equal(envelope.ok, false);
    if (!envelope.ok) {
      assert.equal(envelope.error.code, "INPUT_VALIDATION_FAILED");
    }

    // 使用 runtime.run 断言抛出规范化异常
    await assert.rejects(
      async () => {
        await runtime.run("math.divide", { dividend: 10 } as any);
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

const configAction = defineAction((_input, ctx) => {
  const endpoint = ctx.config.get<string>("ENDPOINT_URL", "https://default.api");
  const timeout = ctx.config.get<number>("TIMEOUT_MS", 3000);
  return { endpoint, timeout };
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

### 状态持久化与虚拟时钟失效测试

验证状态存取、命名空间隔离以及基于 `FakeClock` 瞬间推进时间的自动过期机制，无需真实等待：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime, FakeClock } from "@actiondock/testing";

const sessionAction = defineAction(async (input: { userId: string }, ctx) => {
  const token = `token-${input.userId}`;
  // 写入具有 10 秒生存时间的状态
  await ctx.state.set(`token:${input.userId}`, token, 10);
  return { token };
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

const longRunningAction = defineAction(async (_input, ctx) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ finished: true }), 1000);
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
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

### 外部命令行模拟测试

验证通过 `MockProcessExecutor` 预设外部 CLI 返回结果与命令调用记录校验：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime } from "@actiondock/testing";

const gitStatusAction = defineAction(async (_input, ctx) => {
  const proc = await ctx.process.exec("git", ["status", "--porcelain"]);
  const isClean = proc.stdout.trim() === "";
  return { isClean, raw: proc.stdout };
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

### 下游动作模拟与多目标命名绑定测试

下游依赖存在命名绑定时，可通过 `runtime.actions` 模拟主服务错误并显式降级至备用服务。
同时断言调用时序与输入快照。
示例仅适用于只读报价查询，不可直接用于写操作：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionDockError } from "@actiondock/core";
import { defineAction } from "@actiondock/sdk";
import { ActionRuntimeError, createTestRuntime } from "@actiondock/testing";

const quoteOrderAction = defineAction({
  uses: ["pricing/quote"],
  run: async (input: { sku: string }, ctx) => {
    try {
      return await ctx.actions.invoke(
        "pricing/quote",
        { sku: input.sku },
        { binding: "primary" }
      );
    } catch (error: any) {
      if (
        ctx.signal.aborted ||
        !["SERVICE_RESULT_UNKNOWN", "NETWORK_ERROR"].includes(error?.code)
      ) {
        throw error;
      }
      return await ctx.actions.invoke(
        "pricing/quote",
        { sku: input.sku },
        { binding: "fallback" }
      );
    }
  },
});

describe("多目标命名绑定与降级测试", () => {
  it("主服务异常且未取消时显式降级至备用报价", async () => {
    const runtime = createTestRuntime({ packageId: "order-pkg" });

    // 针对 primary 绑定注册处理函数并抛出指定可用性错误
    runtime.actions.register(
      "pricing/quote",
      () => {
        throw new ActionDockError(
          "SERVICE_RESULT_UNKNOWN",
          "Primary pricing cluster temporarily unreachable"
        );
      },
      { binding: "primary" }
    );

    // 针对 fallback 绑定注册静态返回结果
    runtime.actions.register(
      "pricing/quote",
      { price: 99, currency: "USD" },
      { binding: "fallback" }
    );

    const result = await runtime.run(quoteOrderAction, { sku: "ITEM-1" });
    assert.deepStrictEqual(result, { price: 99, currency: "USD" });

    // 严格审查调用历史
    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 2);

    assert.strictEqual(calls[0].ref, "pricing/quote");
    assert.strictEqual(calls[0].binding, "primary");
    assert.deepStrictEqual(calls[0].input, { sku: "ITEM-1" });

    assert.strictEqual(calls[1].ref, "pricing/quote");
    assert.strictEqual(calls[1].binding, "fallback");
    assert.deepStrictEqual(calls[1].input, { sku: "ITEM-1" });

    // 通过 getCalls 按绑定精确检索
    const fallbackCalls = runtime.actions.getCalls("pricing/quote", {
      binding: "fallback",
    });
    assert.strictEqual(fallbackCalls.length, 1);
  });
});
```

- 真实上下文执行：模拟函数接收内核分配的真实 `ActionContext`。函数可抛出 `ActionDockError` 或标准 `Error`。执行引擎保留 `ActionRuntimeError` 最终错误码。
- 绑定精确匹配与安全红线：未传 `binding` 缺省为 `default`。具名绑定严格精确匹配。未命中绑定的调用直接抛出错误。系统不隐式回退到 `default`，也不访问真实网络。
- 契约与权限校验：测试框架不自动补充 `uses`。缺少声明的跨包调用直接拒绝，模拟函数不执行。本地同包调用保持豁免。模拟动作跨包调用时，通过 `contract.uses` 声明权限。
- 一次性规则与接替机制：使用 `registerOnce` 注册先进先出响应队列。队列耗尽后由持续规则接替。若无持续规则，再次调用直接抛出错误，不复用最后响应。
- 状态清理与版本自增：`clearHistory()` 清空历史记录。`reset()` 同时清空规则与历史。规则修改与重置自动递增版本号。请在执行前完成调整，避免在执行中修改规则。共享实例共享队列。
- 混合本地替身动作：测试运行时支持注册本地替身动作。替身动作与具名模拟规则协同执行。
- 集成测试边界说明：内存模拟不能证明网络协议正常工作。核心交付链路仍需通过回环服务执行集成测试。

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

# 亦可通过 ActionDock 命令执行
ad test
```
