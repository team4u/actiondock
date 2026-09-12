# 参考手册：Testing 测试框架 API

[`@actiondock/testing`](../../packages/testing/README.md) 是 ActionDock 2.0 官方测试框架，提供毫秒级确定性纯内存测试沙箱、虚拟单调时钟、进程调用拦截模拟与内存持久化存储引擎，完全对齐 Node.js 原生测试标准（`node:test`、`node:assert/strict`）。

---

## 核心导出函数：createTestRuntime

用于初始化一个轻量、受控、零外部依赖的纯内存测试运行时：

```ts
import { createTestRuntime, type TestRuntimeOptions } from "@actiondock/testing";

const runtime = createTestRuntime(options?: TestRuntimeOptions);
```

### TestRuntimeOptions 配置项

- 项目配置定义：`projectConfig`
  模拟 `actiondock.json` 清单定义，包含 `id`、`config`、`actions` 与模式约束。
- 动作注册表：`actions`
  动作标识符与动作实现对象或函数的映射字典。
- 自定义虚拟时钟：`clock`
  传入自定义的 `FakeClock` 实例。缺省时自动创建独立的新时钟。
- 模拟进程执行器：`process`
  传入自定义的 `MockProcessExecutor` 实例。缺省时自动创建全新实例。
- 初始配置字典：`config`
  初始化注入的配置键值映射。
- 初始状态字典：`state`
  初始化预置的状态键值映射。
- 底层存储引擎：`storage`
  可选注入的自定义内存存储实例。
- 日志记录器：`logger`
  可选注入的日志记录器实例（默认使用 `MemoryLogger`）。

---

## TestRuntime 实例接口

`createTestRuntime` 返回的运行时对象暴露以下核心执行与插桩方法：

### 直接解包执行：runtime.run

执行指定 Action 并直接返回业务输出。如果执行发生错误、模式校验失败或超时，直接抛出 `ActionRuntimeError`：

```ts
const output = await runtime.run<TOutput>(action, input);
```

参数与返回值：
- `action`：动作标识符字符串或通过 `defineAction` 定义的动作对象。
- `input`：符合动作输入模式的传参数据。
- 返回值：Promise 解析为业务输出数据对象。

### 信封包装执行：runtime.execute

执行指定 Action 并返回结构完整的执行信封，无论成功或失败均不抛出异常，便于验证错误码：

```ts
const envelope = await runtime.execute(action, input, options?: RunOptions);

if (envelope.ok) {
  console.log("执行成功:", envelope.data);
} else {
  console.error("执行失败:", envelope.error.code, envelope.error.message);
}
```

### 插桩属性说明

- 确定性虚拟时钟：`runtime.clock`
  绑定的 `FakeClock` 实例，提供精确的时间前进与单调时钟控制。
- 进程模拟器：`runtime.process`
  绑定的 `MockProcessExecutor` 实例，用于注册外部命令模拟规则与审查调用历史。
- 测试配置管理器：`runtime.config`
  提供 `set(key, value)`、`get(key)` 与 `list()` 方法，在测试中动态变更配置。
- 测试状态库：`runtime.state`
  提供 `get(key)`、`set(key, value, ttl?)`、`keys()` 与 `scope(ns)` 方法，检查持久化数据。
- 内存存储实例：`runtime.storage`
  底层纯内存存储驱动 `MemoryStorage`。
- 生命周期事件汇总：`runtime.events`
  汇总记录 Action 执行生命周期产生的各类事件，支持断言事件派发顺序。

---

## 确定性虚拟时钟：FakeClock

`FakeClock` 彻底解耦物理时间推进，实现对超时测试与周期任务的精确快进：

```ts
import { FakeClock } from "@actiondock/testing";

const clock = new FakeClock(initialTimestamp?: number);
```

方法契约：

- 获取当前虚拟时间戳：`clock.now(): number`
  返回毫秒级虚拟墙上时间戳。
- 获取单调时间戳：`clock.monotonic(): number`
  返回不受墙上时间跳变影响的单调递增毫秒时间戳。
- 快进虚拟时间：`await clock.advance(ms: number): Promise<void>`
  瞬间推进指定毫秒数，按预设时间触发所有到期的微任务与定时器。
- 注册超时回调：`clock.setTimeout(fn, delay): NodeJS.Timeout`
  在指定虚拟时间后触发执行。
- 清理定时器：`clock.clearTimeout(timer): void`
  取消指定定时器。

---

## 进程执行模拟器：MockProcessExecutor

`MockProcessExecutor` 拦截动作通过 `ctx.process` 发起的所有系统命令派生，杜绝在单元测试中执行破坏性的外部命令：

```ts
import { MockProcessExecutor } from "@actiondock/testing";

const executor = new MockProcessExecutor();
```

方法契约：

- 注册匹配规则：`executor.registerRule(rule: MockProcessRule): void`
  注册命令拦截匹配规则。支持匹配命令名、参数正则或谓词函数：
  ```ts
  executor.registerRule({
    match: (cmd, args) => cmd === "git" && args[0] === "status",
    output: {
      stdout: "On branch main\nnothing to commit",
      stderr: "",
      exitCode: 0,
    },
  });
  ```
- 模拟执行异常：通过在规则中配置 `exitCode: 1` 或 `timedOut: true` 模拟失败场景。
- 审查调用历史：`executor.getHistory(): ProcessCall[]`
  返回按时间排序的全部外部命令调用记录，便于进行参数与频次断言。
- 重置状态：`executor.reset(): void`
  清空已注册的所有规则与调用历史。

---

## 内存持久化存储：MemoryStorage

`MemoryStorage` 在内存中模拟生产环境的 SQLite 存储行为，提供完全一致的键值操作与过期时间淘汰逻辑：

- 强隔离命名空间：各包与动作的状态在内存中通过命名空间进行物理隔离。
- 虚拟时钟联动淘汰：当虚拟时钟推进时，已过期的键值自动被判定为无效并物理清理。
- 零磁盘持久化开销：测试执行完毕后自动被垃圾回收机制回收，彻底杜绝测试遗留临时文件。

---

## 运行时异常类：ActionRuntimeError

当使用 `runtime.run()` 遇到失败时抛出的规范异常：

```ts
export class ActionRuntimeError extends Error {
  readonly code: string;
  readonly details?: unknown;
}
```

常用断言模式：

```ts
import assert from "node:assert/strict";
import { ActionRuntimeError } from "@actiondock/testing";

try {
  await runtime.run("my.action", invalidInput);
  assert.fail("应当抛出异常");
} catch (err) {
  assert.ok(err instanceof ActionRuntimeError);
  assert.equal(err.code, "INPUT_VALIDATION_FAILED");
}
```
