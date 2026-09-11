# @actiondock/sdk

ActionDock 2.0 纯净核心开发者接口契约包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/sdk` 为开发者编写原子 Action 提供零生产依赖的纯净类型定义与核心契约。测试工具（`createTestRuntime`、`FakeClock`、`MockProcessExecutor`、`MemoryStorage`）已全面收敛至 [@actiondock/testing](../testing/README.md)。

---

## 安装方式

使用标准包管理器添加依赖：

```bash
npm install @actiondock/sdk
```

---

## 核心接口与函数

### defineAction 函数

用于定义具备强类型推导的原子 Action 业务逻辑：

```ts
import { defineAction } from "@actiondock/sdk";

export interface AddInput {
  a: number;
  b: number;
}

export interface AddOutput {
  result: number;
}

export default defineAction(async (input: AddInput, ctx): Promise<AddOutput> => {
  ctx.log.info(`计算加法: ${input.a} + ${input.b}`);
  return {
    result: input.a + input.b,
  };
});
```

也可以传入包含 `run` 方法的对象形式：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  async run(input, ctx) {
    return { ok: true };
  },
});
```

---

## ActionContext 运行时上下文

在 Action 执行时，宿主环境注入标准化上下文对象 `ActionContext`，提供受控的系统交互能力：

- `ctx.process`：统一进程操作接口 ProcessAPI，仅提供 `exec` 与 `spawn` 方法，支持执行外部命令、超时控制、取消信号响应与缓冲区防爆保护。
- `ctx.log`：结构化日志输出接口 Logger，提供 `debug`、`info`、`warn`、`error` 级别日志。日志严格输出至标准错误流，彻底隔离标准输出流，杜绝污染协议报文。
- `ctx.progress`：进度报告器 ProgressReporter，支持在执行过程中通过 `report(current, total, message)` 上报当前阶段。
- `ctx.signal`：协作式取消信号 AbortSignal。当任务被外部客户端取消或超时时自动触发中止。
- `ctx.run`：当前执行实例元数据，包含 `id`（本次运行标识）、`rootId`（根调用标识）和 `parentId`（父级调用标识）。
- `ctx.config`：分层配置读取接口 Config，提供 `get` 与 `has` 方法，支持优先级回退与类型强转。
- `ctx.state`：持久化状态接口 StateStore，提供基于当前包命名空间隔离的键值存储与存活时间控制。
- `ctx.actions`：动作相互调用接口 ActionInvoker，支持直接调用或通过 `invoke` 方法调用下游 Action，并内置调用栈环路死锁检测。

---

## 单元测试支持

测试工具已全面收敛至 [@actiondock/testing](../testing/README.md)。在测试中使用 `createTestRuntime` 进行纯内存毫秒级验证：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import addAction from "../actions/add.js";

describe("add action", () => {
  it("calculates sum correctly", async () => {
    const runtime = createTestRuntime();
    const res = await runtime.run(addAction, { a: 10, b: 20 });
    assert.equal(res.result, 30);
  });
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
