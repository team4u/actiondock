# 参考手册：Action 单元测试与动作模拟

本参考手册面向 Action 工具开发者。它指导如何使用纯内存测试运行时。开发者可通过 `MockActionInvoker` 精确模拟并断言下游依赖与命名绑定。

## 内容索引

- [核心架构与设计哲学](#核心架构与设计哲学)
- [动作模拟器核心接口](#动作模拟器核心接口)
- [多目标绑定与显式降级测试](#多目标绑定与显式降级测试)
- [一次性响应与持续规则接替](#一次性响应与持续规则接替)
- [契约校验与权限治理](#契约校验与权限治理)
- [历史审查与生命周期管理](#历史审查与生命周期管理)
- [混合本地替身与集成测试边界](#混合本地替身与集成测试边界)

---

## 核心架构与设计哲学

在 ActionDock 2.x 中，单元测试运行时 `createTestRuntime` 统一暴露 `runtime.actions`。它是一个 `MockActionInvoker` 实例。

- 真实上下文执行：模拟处理函数 `handler(input, ctx)` 接收系统派发的真实 `ActionContext`。它保留真实的执行标识、事件流与日志门面，不伪造上下文对象。
- 内核执行管道全覆盖：所有通过模拟器派发的调用均通过内核 `ActionRunner` 管道。系统严格校验输入参数、输出结果、依赖授权、协同取消信号、执行深度与调用环路。
- 绑定精确匹配：所有命名绑定调用必须与注册规则精确匹配。未命中绑定的调用直接阻断并抛出错误，绝不隐式回退到默认绑定或访问外部环境。
- 实例隔离与按需注入：每个测试运行时默认拥有独立的模拟器实例。若需在多运行时之间共享历史与规则，可通过选项 `actionsMock` 显式注入。模拟调用使用测试运行时自己的目标端口。
- 配置密钥隔离：`createTestRuntime` 与 `MemoryStorage` 保持纯内存，无需读取真实加密密钥。校验持久化加密时，向 `configKeyProvider` 注入测试密钥。数据库与密钥均使用临时目录，显式隔离密钥，不得读取或生成用户目录密钥。
- 规则版本自增机制：注册规则或重置模拟器时单调自增版本号。这驱动运行时使同名替换立即生效。在 `run` 或 `execute` 前完成规则调整。共享模拟器会共享队列与历史，需要隔离时使用独立实例。

---

## 动作模拟器核心接口

`runtime.actions` 提供了注册模拟规则与检索调用历史的标准方法：

- 持续规则注册：`runtime.actions.register(ref, handlerOrJsonResult, options)`
  注册持久生效的模拟规则。`ref` 支持完全限定引用或短名称。`handlerOrJsonResult` 支持传入动态处理函数或静态结果。`options` 包含可选的 `binding` 与 `contract`。
- 一次性规则注册：`runtime.actions.registerOnce(ref, handlerOrJsonResult, options)`
  注册仅消费一次的队列模拟规则。相同引用和绑定的规则按先进先出顺序依次消费。
- 调用历史快照：`runtime.actions.calls`
  获取所有捕获的调用记录列表。
- 条件筛选历史：`runtime.actions.getCalls(ref, options)`
  按动作引用或绑定名称精确筛选调用记录。
- 仅清空历史记录：`runtime.actions.clearHistory()`
  仅清空已记录的调用历史。它保留所有已注册的模拟规则，不推进版本号。
- 完全重置模拟器：`runtime.actions.reset()`
  清空所有调用历史与全部模拟规则。它单调递增版本号以便驱逐宿主缓存。

### 调用记录数据模型

每次触发模拟调用时，模拟器自动将入参克隆为不可变快照，并生成包含以下属性的 `MockActionCall` 记录：

- 规范化动作引用：`ref`，例如 `pricing/quote`。
- 命中绑定名称：`binding`，未显式指定时记录为 `default`。
- 入参深拷贝快照：`input`，防止调用方后续修改入参造成断言污染。
- 子任务执行标识：`runId`，当前执行动作的实际执行标识。
- 根任务执行标识：`rootRunId`，整条调用链路根任务的唯一标识。
- 调用时间戳：`timestamp`，调用发生时的毫秒时间戳。

---

## 多目标绑定与显式降级测试

在多目标调用的业务场景中，核心模式是在测试中模拟主绑定的指定可用性错误。业务未接收取消信号时，平滑执行备用绑定。

业务代码应当精确匹配特定错误代码，严禁无条件捕获所有错误。此例仅适用于无副作用且允许备用结果的查询。写操作不能因远端断链就换端重跑，必须先核验执行结果或具备业务幂等机制：

```typescript
import { defineAction } from "@actiondock/sdk";

export const quoteOrderAction = defineAction({
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
```

针对上述动作的单元测试用例如下：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionDockError } from "@actiondock/core";
import { createTestRuntime } from "@actiondock/testing";
import { quoteOrderAction } from "../actions/quote-order.ts";

describe("报价降级流程测试", () => {
  it("主服务返回可用性错误时显式降级至备用报价", async () => {
    const runtime = createTestRuntime({ packageId: "order-pkg" });

    // 主绑定使用处理函数抛出指定可用性错误
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

    // 备用绑定返回静态报价结果
    runtime.actions.register(
      "pricing/quote",
      { price: 99, currency: "USD" },
      { binding: "fallback" }
    );

    const result = await runtime.run(quoteOrderAction, { sku: "ITEM-001" });

    // 断言业务获得备用服务计算的价格
    assert.deepStrictEqual(result, { price: 99, currency: "USD" });

    // 断言调用历史与调用顺序
    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 2);

    assert.strictEqual(calls[0].ref, "pricing/quote");
    assert.strictEqual(calls[0].binding, "primary");
    assert.deepStrictEqual(calls[0].input, { sku: "ITEM-001" });

    assert.strictEqual(calls[1].ref, "pricing/quote");
    assert.strictEqual(calls[1].binding, "fallback");
    assert.deepStrictEqual(calls[1].input, { sku: "ITEM-001" });

    // 通过条件筛选单独断言备用调用记录
    const fallbackCalls = runtime.actions.getCalls("pricing/quote", {
      binding: "fallback",
    });
    assert.strictEqual(fallbackCalls.length, 1);
  });
});
```

---

## 一次性响应与持续规则接替

需要验证重试逻辑、轮询状态或序列变化时，使用 `registerOnce` 注册一次性响应：

- 先进先出消费：多个 `registerOnce` 规则按注册顺序依次出队返回。
- 耗尽明确失败：一次性规则队列消费完毕后，若未注册持续规则，再次调用立即抛出错误。系统不会重复使用最后一次响应，也不会穿透调用真实实现。
- 显式规则接替：若同时注册了持续规则，队列耗尽后由持续规则继续接管后续调用。

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import { defineAction } from "@actiondock/sdk";

describe("一次性响应与规则接替", () => {
  it("队列消费完毕后由持续规则接替执行", async () => {
    const runtime = createTestRuntime({ packageId: "task-pkg" });

    runtime.actions
      .registerOnce("remote/status", { status: "pending" })
      .registerOnce("remote/status", { status: "running" })
      .register("remote/status", { status: "completed" });

    const checkAction = defineAction({
      uses: ["remote/status"],
      run: async (_input, ctx) => ctx.actions.invoke("remote/status", {}),
    });

    const step1 = await runtime.run(checkAction, {});
    assert.deepStrictEqual(step1, { status: "pending" });

    const step2 = await runtime.run(checkAction, {});
    assert.deepStrictEqual(step2, { status: "running" });

    const step3 = await runtime.run(checkAction, {});
    assert.deepStrictEqual(step3, { status: "completed" });

    const step4 = await runtime.run(checkAction, {});
    assert.deepStrictEqual(step4, { status: "completed" });
  });
});
```

---

## 契约校验与权限治理

模拟动作与真实动作一样遵循 ActionDock 规范：

- 权限清单校验：跨包及具名独立目标调用须在 `uses` 中声明依赖。当前宿主内默认绑定的同包调用保持豁免。测试框架不自动补权限，未授权的模拟处理函数不会执行。
- 输入与输出约束：在注册规则时可通过 `contract` 注入 `inputSchema` 与 `outputSchema`。内核严格校验入参与返回值。非法入参或出参均触发模式校验失败错误。
- 模拟动作级联调用：模拟动作处理函数调用其他跨包动作时，必须在 `contract.uses` 中声明所需权限。否则内核拒绝跨包调度。
- 取消与环路熔断：模拟动作与上游共享 `ctx.signal`。父级超时或主动取消会同步通知模拟动作。模拟动作与上游形成死锁环路时，系统直接抛出环路调用错误并熔断。

```typescript
runtime.actions.register(
  "inventory/deduct",
  (input: { count: number }) => ({ success: true, remaining: 100 - input.count }),
  {
    contract: {
      inputSchema: {
        type: "object",
        properties: { count: { type: "number", minimum: 1 } },
        required: ["count"],
      },
      outputSchema: {
        type: "object",
        properties: { success: { type: "boolean" }, remaining: { type: "number" } },
        required: ["success", "remaining"],
      },
    },
  }
);
```

---

## 历史审查与生命周期管理

- 仅重置历史：调用 `runtime.actions.clearHistory()` 仅清空 `calls` 列表。原有的模拟规则与版本号保持不变。后续测试可继续命中现有规则。
- 完全重置规则：调用 `runtime.actions.reset()` 会清空历史与全部规则。它使内部版本号递增，确保后续调用不再命中旧规则。
- 覆写已有规则：针对相同引用和相同绑定再次调用 `register` 时，内部版本号同样递增。运行时自动逐出内部缓存，使最新逻辑生效。

---

## 混合本地替身与集成测试边界

- 混合本地替身动作：除了使用 `runtime.actions` 模拟外，还可通过 `options.actions` 或 `runtime.registerAction` 注册本地替身 Action。测试运行时天然支持本地替身动作与具名模拟动作混合调用。
- 真实远端隔离安全红线：命名模拟规则在运行时直接拦截。本地无需配置真实凭据，无需网络连接，也无需远端依赖源码。未命中模拟规则的调用严禁访问真实远端网络，杜绝测试污染。
- 集成测试边界说明：动作模拟仅验证调用编排、入参拼装、错误分支与降级状态机。它不能证明真实网络通信与鉴权协议可用。它也不能证明远端取消协议可用。生产核心链路仍需配合真实凭据执行全链路集成测试。
