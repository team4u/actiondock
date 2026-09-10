# @actiondock/testing

ActionDock 2.0 确定性测试框架与测试运行时。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/testing` 为 ActionDock 工具与技能开发者提供确定性、无物理外设依赖且具备完整 Core 执行语义的单元测试框架。测试工具已全面收敛至本包。

---

## 核心组件与测试能力

### createTestRuntime 测试运行时工厂

[createTestRuntime](file:///root/code/action-dock/packages/testing/src/runtime.ts) 是深度复用核心执行引擎的测试脚手架：

- 真实生命周期校验：在纯内存测试中同步执行输入输出模式校验、调用环路死锁检测与超时控制。
- 双模态执行接口：支持通过 `run` 直接获取业务结果（失败时抛出 ActionRuntimeError 规范异常），或通过 `execute` 获取包含运行标识与元数据的完整信封。
- 全要素调试暴露：测试运行时直接暴露 `config`、`state`、`clock`、`process`、`events`、`logger` 与 `storage` 实例，便于注入先验数据并断言副作用。

### FakeClock 确定性时钟

[FakeClock](file:///root/code/action-dock/packages/testing/src/clock.ts) 解耦物理系统时钟，消除异步定时器测试中的偶发性等待与竞态：

- 模拟墙上时间与单调递增时间戳。
- 通过 `advance(ms)` 瞬间推进模拟时间，并以确定性顺序依次唤醒挂起的计时器与延迟任务。
- 支持时间倒流检测与高精度时间戳快照。

### MockProcessExecutor 模拟进程执行器

[MockProcessExecutor](file:///root/code/action-dock/packages/testing/src/process.ts) 在沙箱中拦截并伪造所有外部系统命令与子进程调用：

- 灵活规则匹配：通过 `onCommand` 注册匹配器，支持字符串完全匹配、正则表达式匹配或自定义断言谓词函数。
- 丰富的响应定义：支持模拟标准输出、标准错误流、非零退出码、二进制字节流以及执行耗时。
- 异常场景复现：可直接模拟命令执行超时（`timedOut`）或取消信号阻断（`cancelled`）。
- 调用历史追踪：精确记录每次调用的完整入参、工作目录与环境变量，提供断言追踪支持。

### MemoryStorage 纯内存存储

[MemoryStorage](file:///root/code/action-dock/packages/testing/src/storage.ts) 基于纯内存构建的无磁盘运行时存储实现：

- 具备与生产环境持久化存储完全相同的配置优先级解析规则与事务边界。
- 完整支持状态数据的命名空间隔离、前缀检索与基于存活时间的自动过期判定。
- 完整持久化运行历史记录与结构化输入输出快照。

---

## 快速使用示例

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime, MockProcessExecutor } from "@actiondock/testing";

const gitBranchAction = defineAction(async (input: { remote?: boolean }, ctx) => {
  const res = await ctx.process.exec("git", ["branch"]);
  return { output: res.stdout.trim() };
});

describe("git action test", () => {
  it("mocks process and asserts output", async () => {
    // 初始化模拟执行器并配置预设响应
    const processExecutor = new MockProcessExecutor();
    processExecutor.onCommand("git", {
      stdout: "* main\n  feature/agent\n",
    });

    // 创建测试运行时并注入执行器
    const runtime = createTestRuntime({
      process: processExecutor,
    });

    // 执行 Action 并断言业务数据
    const result = await runtime.run(gitBranchAction, { remote: false });
    assert.equal(result.output, "* main\n  feature/agent");

    // 断言底层命令调用历史
    assert.equal(processExecutor.getHistory().length, 1);
  });
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
