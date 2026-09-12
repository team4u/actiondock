# 实战食谱：多 Action 组合编排与防死锁

在微服务与智能体架构中，高级业务 Action 往往需要将多个原子 Action 组合串联起来。例如一个订单创建动作，需要先调用库存扣减动作，再调用消息推送动作。

本实战食谱指导开发者如何使用 `ctx.actions.invoke` 安全地进行多动作级联调用，理解调用栈追踪、上下文继承、死锁环路阻断与并发限制。

---

## 级联调用的设计约束与安全防护

在传统的函数嵌套中，未经管控的相互调用极易引发严重问题：

- 递归死锁与栈溢出：若动作 A 调用动作 B，动作 B 在某种条件下又回拨调用动作 A，会导致死锁甚至进程栈溢出崩溃。
- 上下文与链路断裂：子调用未能继承根调用标识与取消信号，导致审计日志脱节且取消无法下发。
- 并发滥用放大：单个动作派生上百个并发子任务，导致底层系统资源被耗尽。

ActionDock 引擎提供全方位的级联防护机制：

- 环路依赖检测：运行时全程维护调用链栈数组。一旦发现调用路径出现闭合环路（如 A -> B -> A），立即阻断并抛出 `ACTION_CYCLE_DETECTED` 错误码。
- 单一事实源契约：`ctx.actions.invoke` 仅允许传入动作标识符字符串或规范的引用对象，严禁传入裸函数或未在清单中声明的对象，违者抛出 `INVALID_ACTION_REF`。
- 根调用全链路继承：子任务自动继承 `rootId`，记录 `parentId`，并深度绑定父级的 `AbortSignal` 取消信号。
- 并发度硬限流：单动作内部并行发起的子动作调用上限固定为 16，超额排队或受阻，杜绝雪崩效应。

---

## 编写组合 Action

实现一个编排动作 `order.process`：

```ts
import { defineAction } from "@actiondock/sdk";

export interface ProcessOrderInput {
  orderId: string;
  sku: string;
  quantity: number;
  customerEmail: string;
}

export interface ProcessOrderOutput {
  success: boolean;
  orderId: string;
  inventoryDeducted: boolean;
  notificationSent: boolean;
}

export default defineAction(async (input: ProcessOrderInput, ctx): Promise<ProcessOrderOutput> => {
  ctx.log.info(`开始编排处理订单: ${input.orderId}，根调用标识: ${ctx.run.rootId}`);

  // 第一步：级联调用库存扣减动作 inventory.deduct
  ctx.log.info(`调用库存子动作扣减 SKU: ${input.sku} 数量: ${input.quantity}`);
  const inventoryResult = await ctx.actions.invoke<{ success: boolean }>(
    "inventory.deduct",
    {
      sku: input.sku,
      quantity: input.quantity,
    }
  );

  if (!inventoryResult.success) {
    throw new Error(`库存不足，无法处理订单 ${input.orderId}`);
  }

  // 第二步：级联调用通知动作 notification.send
  ctx.log.info(`调用通知子动作发送邮件至: ${input.customerEmail}`);
  const notifyResult = await ctx.actions.invoke<{ messageId: string }>(
    "notification.send",
    {
      recipient: input.customerEmail,
      title: "订单处理成功",
      content: `您的订单 ${input.orderId} 已确认。`,
    }
  );

  return {
    success: true,
    orderId: input.orderId,
    inventoryDeducted: true,
    notificationSent: Boolean(notifyResult.messageId),
  };
});
```

---

## 编写组合调用与环路阻断测试

使用 `@actiondock/testing` 验证子动作级联调用以及死锁环路拦截：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime, ActionRuntimeError } from "@actiondock/testing";

describe("多动作组合与环路阻断测试", () => {
  it("应当顺利完成多动作级联调用", async () => {
    // 定义模拟子动作
    const deductAction = defineAction({
      run(input: { sku: string; quantity: number }) {
        return { success: true };
      },
    });

    const notifyAction = defineAction({
      run(input: { recipient: string }) {
        return { messageId: "msg-999" };
      },
    });

    // 编排动作
    const processAction = defineAction({
      async run(input: any, ctx) {
        const res1 = await ctx.actions.invoke<{ success: boolean }>("inventory.deduct", input);
        const res2 = await ctx.actions.invoke<{ messageId: string }>("notification.send", input);
        return { ok: res1.success && Boolean(res2.messageId) };
      },
    });

    const runtime = createTestRuntime({
      actions: {
        "order.process": processAction,
        "inventory.deduct": deductAction,
        "notification.send": notifyAction,
      },
    });

    const result = await runtime.run("order.process", {
      sku: "ITEM-A",
      quantity: 1,
      recipient: "user@example.com",
    });

    assert.equal(result.ok, true);
  });

  it("发生循环递归调用时必须立即阻断并抛出 ACTION_CYCLE_DETECTED", async () => {
    // 构造相互递归动作 A -> B -> A
    const actionA = defineAction({
      async run(input: any, ctx) {
        return await ctx.actions.invoke("action.b", input);
      },
    });

    const actionB = defineAction({
      async run(input: any, ctx) {
        return await ctx.actions.invoke("action.a", input);
      },
    });

    const runtime = createTestRuntime({
      actions: {
        "action.a": actionA,
        "action.b": actionB,
      },
    });

    await assert.rejects(
      async () => {
        await runtime.run("action.a", {});
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.equal(err.code, "ACTION_CYCLE_DETECTED");
        return true;
      }
    );
  });
});
```
