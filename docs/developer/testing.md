# 实践指南：单元测试与沙箱验证 (Testing Guide)

ActionDock 倡导 **“开箱即测试 (Testable by Default)”**。

ActionDock 提供了原生的纯内存测试沙箱 `createTestRuntime`，无需启动任何外部进程或真实数据库，即可快速完成全量验证。

---

## 纯内存测试沙箱 `createTestRuntime`

使用 `@actiondock/sdk` 提供的 `createTestRuntime`：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import myAction from "../actions/my-action";

describe("my-action 单元测试", () => {
  it("在内存沙箱中秒级执行", async () => {
    // 创建纯内存运行时实例
    const runtime = createTestRuntime({
      config: {
        API_TOKEN: "mock-token-123",
        BASE_URL: "https://api.mock.test",
      },
      state: {
        "user:count": 10,
      },
    });

    // 传入 Action 定义与入参
    const result = await runtime.run(myAction, {
      userId: "u-101",
    });

    // 断言返回值
    expect(result.success).toBe(true);

    // 断言持久化状态变更
    const newCount = await runtime.state.get("user:count");
    expect(newCount).toBe(11);

    // 断言日志输出
    expect(runtime.logger.logs.some(l => l.level === "info" && l.message.includes("处理完成"))).toBe(true);
  });
});
```

---

## Action 级联调用测试

Action 之间相互调用在 `TestRuntime` 中天然支持，并内置自动调用栈防环路死锁检测：

```ts
import compositeAction from "../actions/composite";

it("支持 Action 间级联调用测试", async () => {
  const runtime = createTestRuntime({
    config: { ENV: "test" },
  });

  const result = await runtime.run(compositeAction, { task: "deploy" });
  expect(result.status).toBe("done");
});
```

---

## 状态过期 TTL 验证

```ts
it("验证状态 TTL 自动过期", async () => {
  const runtime = createTestRuntime();

  await runtime.state.set("temp_token", "abc", 1); // 1 秒过期 (ttl 秒数)
  expect(await runtime.state.get("temp_token")).toBe("abc");

  // 等待过期
  await new Promise(r => setTimeout(r, 1100));
  expect(await runtime.state.get("temp_token")).toBeUndefined();
});
```

---

## 独立编译契约测试 (Standalone Contract Test)

确保 Action 在源码态与编译后的独立二进制中行为一致：

```bash
# 运行全部单测
ac test

# 编译独立二进制
ac build

# 运行集成验证
./dist/bin/my-tools run my-action --input '{"userId": "u-101"}'
```
