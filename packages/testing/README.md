# @actiondock/testing

ActionDock 2.0 确定性测试框架与测试运行时。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/testing` 为 ActionDock 工具与技能开发者提供确定性、无物理依赖且具备真实 Core 执行语义的单元测试框架。

---

## 核心组件与测试能力

### FakeClock 确定性时钟

解耦真实物理系统时间，彻底消除异步定时器测试中的偶发性失败与等待开销：

- 模拟墙上时间 `now` 与单调递增时间戳 `monotonic`。
- 通过 `advance(ms)` 瞬间推进模拟时间，并以严格确定的顺序依次唤醒挂起的计时器与延迟任务。
- 支持时间倒流检测与高精度时间戳快照。

### MockProcessExecutor 模拟进程执行器

在沙箱中拦截并伪造所有外部系统命令与子进程调用：

- **灵活规则匹配**：通过 `onCommand` 注册匹配器，支持字符串完全匹配、正则表达式匹配或自定义断言谓词函数。
- **丰富的响应定义**：支持模拟标准输出、标准错误流、非零退出码、二进制字节流以及执行耗时。
- **异常场景复现**：可直接模拟命令执行超时（`timedOut`）或取消信号阻断（`cancelled`）。
- **调用历史追踪**：精确记录每次调用的完整入参、工作目录与环境变量，提供便捷的断言追踪支持。

### MemoryStorage 纯内存存储

基于内存 SQLite 驱动构建的无磁盘运行时存储实现：

- 具备与生产环境持久化存储完全相同的配置优先级解析规则与事务边界。
- 完整支持状态数据的命名空间隔离、前缀检索与基于存活时间的自动过期判定。
- 完整持久化运行历史记录与结构化输入输出快照。

### createTestRuntime 测试运行时工厂

深度复用核心引擎 `ActionRunner` 的测试脚手架：

- **真实生命周期校验**：在内存测试中同步执行输入输出 JSON Schema 校验、调用环路死锁检测与超时控制。
- **双模态执行接口**：支持通过 `run` 直接获取业务数据（失败时抛出带有错误码的异常），或通过 `execute` 获取包含运行标识与元数据的完整信封。
- **全要素调试访问**：测试运行时直接暴露 `config`、`state`、`clock`、`process`、`events` 与 `storage` 实例，便于在测试用例中注入先验数据并断言副作用。

---

## 快速使用示例

```ts
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime, FakeClock, MockProcessExecutor } from "@actiondock/testing";

const gitBranchAction = defineAction({
  id: "git.branch",
  inputSchema: {
    type: "object",
    properties: {
      remote: { type: "boolean" },
    },
  },
  async run(input, ctx) {
    const res = await ctx.process.exec("git", ["branch"]);
    return { output: res.stdout.trim() };
  },
});

// 初始化模拟执行器与测试运行时
const processExecutor = new MockProcessExecutor();
processExecutor.onCommand("git", {
  stdout: "* main\n  feature/agent\n",
});

const runtime = createTestRuntime({
  process: processExecutor,
});

// 执行 Action 并断言业务数据
const result = await runtime.run(gitBranchAction, { remote: false });
console.log(result.output);

// 断言底层命令调用记录
console.log(processExecutor.getHistory().length === 1);
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
