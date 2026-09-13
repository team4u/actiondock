# @actiondock/testing

ActionDock 2.0 确定性测试框架与测试运行时。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/testing` 为 ActionDock 工具与技能开发者提供确定性、无物理外设依赖且具备完整 Core 执行语义的单元测试框架。测试工具已全面收敛至本包。

---

## 核心组件与测试能力

### createTestRuntime 测试运行时工厂

[createTestRuntime](./src/runtime.ts) 是深度复用核心执行引擎的测试脚手架：

- 真实生命周期校验：在纯内存测试中同步执行输入输出模式校验、调用环路死锁检测与超时控制。
- 双模态执行接口：支持通过 `run` 直接获取业务结果（失败时抛出 ActionRuntimeError 规范异常），或通过 `execute` 获取包含运行标识与元数据的完整信封。
- 全要素调试暴露：测试运行时直接暴露 `config`、`state`、`clock`、`process`、`events`、`logger` 与 `storage` 实例，便于注入先验数据并断言副作用。

### FakeClock 确定性时钟

[FakeClock](./src/clock.ts) 解耦物理系统时钟，消除异步定时器测试中的偶发性等待与竞态：

- 模拟墙上时间与单调递增时间戳。
- 通过 `advance(ms)` 瞬间推进模拟时间，并以确定性顺序依次唤醒挂起的计时器与延迟任务。
- 支持时间倒流检测与高精度时间戳快照。

### FakeProcessDriver 确定性测试驱动桩

[FakeProcessDriver](./src/process-driver.ts) 完整实现 Core 层的 ProcessDriver 契约，是受管进程测试的核心桩：

- 确定性事件模拟：提供 `emitOutput`、`emitExit`、`emitOutputClosed` 与 `emitFault` 方法，在测试中以确定性时序唤醒观察者。
- 故障与异常注入：提供 `simulateSpawnFailure`、`simulateWriteFailure`、`simulateResizeFailure` 与 `simulateTerminateFailure`，精确验证业务层容错。
- 历史追踪与状态断言：维护 `spawnCalls`、`writes`、`eofCalls`、`interruptCalls`、`resizeCalls`、`terminateCalls` 与 `disposeCalls` 集合，供测试后置断言。
- 动态能力覆写：支持通过 `setCapabilities` 动态调整是否支持 PTY、resize 与 inputEOF 等特征。

### MockProcessExecutor 模拟进程执行器

[MockProcessExecutor](./src/process.ts) 深度集成 ProcessManager 与 FakeProcessDriver，拦截并模拟外部命令与受管进程调用：

- 规则灵活匹配：通过 `register` 注册匹配器，支持命令字符串精确匹配、正则表达式匹配或自定义断言谓词函数。
- 丰富响应定义：支持模拟标准输出、标准错误流、退出状态码、二进制字节流以及执行延迟。
- 受管进程穿透：直接暴露 `driver` 底层驱动与 `processManager` 实例，无缝承接 `run`、`start`、`acquire` 等受管操作。
- 调用历史追踪：精确记录每次调用的命令、参数、工作目录与环境变量。

### MemoryStorage 纯内存存储

[MemoryStorage](./src/storage.ts) 基于纯内存构建的无磁盘运行时存储实现：

- 具备与生产环境持久化存储完全相同的配置优先级解析规则与事务边界。
- 完整支持状态数据的命名空间隔离、前缀检索与基于存活时间的自动过期判定。
- 完整持久化运行历史记录与结构化输入输出快照。

---

## 快速使用示例

### 一次性受管进程命令测试

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction, decodeText } from "@actiondock/sdk";
import { createTestRuntime, FakeProcessDriver } from "@actiondock/testing";

const gitBranchAction = defineAction(async (input: { remote?: boolean }, ctx) => {
  const res = await ctx.process.run({
    spec: { executable: "git", args: ["branch"], io: { mode: "pipe" } },
    timeoutMs: 5000,
    maxOutputBytes: 1024 * 1024,
  });
  return { output: decodeText(res.chunks).trim() };
});

describe("git action test", () => {
  it("使用 FakeProcessDriver 模拟输出并断言", async () => {
    const fakeDriver = new FakeProcessDriver();
    fakeDriver.onSpawn = (handle) => {
      handle.emitOutput("stdout", "* main\n  feature/agent\n");
      handle.emitExit(0);
      handle.emitOutputClosed("natural");
    };

    const runtime = createTestRuntime({
      platform: { processDriver: fakeDriver } as any,
    });

    const result = await runtime.run(gitBranchAction, { remote: false });
    assert.equal(result.output, "* main\n  feature/agent");
    assert.equal(fakeDriver.spawnCalls.length, 1);
  });
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
