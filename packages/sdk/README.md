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

- `ctx.process`：统一受管进程接口 ProcessAPI，提供一次性执行 run、长期受管进程 start、独占控制权治理、逐流增量读取与优雅终止。
- `ctx.log`：结构化日志输出接口 Logger，提供 `debug`、`info`、`warn`、`error` 级别日志。日志严格输出至标准错误流，彻底隔离标准输出流，杜绝污染协议报文。
- `ctx.progress`：进度报告器 ProgressReporter，支持在执行过程中通过 `report(current, total, message)` 上报当前阶段。
- `ctx.signal`：协作式取消信号 AbortSignal。当任务被外部客户端取消或超时时自动触发中止。
- `ctx.run`：当前执行实例元数据，包含 `id`（本次运行标识）、`rootId`（根调用标识）和 `parentId`（父级调用标识）。
- `ctx.config`：分层配置读取接口 Config，提供 `get` 与 `has` 方法，支持优先级回退与类型强转。
- `ctx.state`：持久化状态接口 StateStore，提供基于当前包命名空间隔离的键值存储与存活时间控制。
- `ctx.actions`：动作相互调用接口 ActionInvoker，支持直接调用或通过 `invoke` 方法调用下游 Action，并内置调用栈环路死锁检测。

---

## 受管进程接口与辅助工具

SDK 为受管进程提供了完整的接口契约与开箱即用的高阶交互工具：

### 核心接口 ProcessAPI

- `ctx.process.run(input, call)`：一次性运行外部命令，超时自动终止并收集有限输出。
- `ctx.process.start(input, call)`：创建长期受管进程，返回进程元数据与输出流初始游标。
- `ctx.process.inspect(id, call)`：查看指定受管进程的最新状态快照。
- `ctx.process.list(input, call)`：分页列出当前可见的受管进程。
- `ctx.process.acquire(id, input, call)`：申请指定进程的独占控制令牌。
- `ctx.process.renew(id, token, ttlMs, call)`：延长控制令牌的存活时间。
- `ctx.process.release(id, token, call)`：显式释放控制令牌。
- `ctx.process.write(id, input, call)`：向受管进程输入流写入 Base64 编码的原始字节。
- `ctx.process.operation(id, requestId, call)`：按请求标识查询写入或控制操作的调度收据。
- `ctx.process.read(id, input, call)`：基于游标读取有界原始输出日志，支持长轮询与断层跳跃。
- `ctx.process.control(id, input, call)`：发送 `input-eof`、`interrupt-foreground` 或 `resize` 结构化控制指令。
- `ctx.process.stop(id, input, call)`：优雅终止受管进程并执行跨平台进程树清理。

### 高阶辅助工具函数

- `withControl(api, processId, options, fn)`：在独占控制权保护下执行异步业务函数。自动申请令牌、在存活期内按三分之一 TTL 周期定期自动续租、正常完成显式调用 `release`；若发生异常、取消中断或续租失败，严禁调用 `release`，主动按契约调用 `stop` 隔离或终止进程并抛出原始错误。
- `createStreamDecoder()`（别名 `createIncrementalTextDecoder()`）：创建逐流增量 UTF-8 解码器，为不同输出流独立缓存残缺的多字节字符，杜绝切块乱码与多流交错污染。
- `encodeText(text)` / `encodeBytes(data)`：将纯文本或二进制数据编码为标准的 Base64 `Bytes` 结构。
- `decodeText(bytesOrChunks)` / `decodeBytes(bytes)`：将 `Bytes` 结构或 `OutputChunk` 数组快速解码为 UTF-8 文本或二进制数组。

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
