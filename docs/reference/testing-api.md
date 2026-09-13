# 参考手册：Testing 测试框架 API

`@actiondock/testing` 是 ActionDock 2.0 官方测试框架，提供毫秒级确定性纯内存测试沙箱、虚拟单调时钟、进程调用拦截模拟与内存持久化存储引擎，完全对齐 Node.js 原生测试标准（`node:test`、`node:assert/strict`）。

---

## 核心导出函数：createTestRuntime

用于初始化一个轻量、受控、零外部依赖的纯内存测试运行时：

```ts
import { createTestRuntime, type TestRuntimeOptions } from "@actiondock/testing";

const runtime = createTestRuntime(options?: TestRuntimeOptions);
```

### TestRuntimeOptions 配置项

- 清单项目配置：`projectConfig`
  模拟 `actiondock.json` 清单定义，包含 `id`、`config`、`actions` 与模式约束。
- 包标识：`packageId`
  指定当前测试沙箱运行的包标识符，缺省时使用 `projectConfig.id` 或默认包名。
- 动作注册表：`actions`
  动作标识符与动作实现对象或处理函数的映射字典，支持字典对象或 Map。
- 自定义虚拟时钟：`clock`
  传入自定义的 `FakeClock` 实例。缺省时自动创建独立的新时钟。
- 模拟进程执行器：`process`
  传入自定义的 `MockProcessExecutor` 实例。缺省时自动创建全新实例。
- 初始配置字典：`config`
  初始化注入的配置键值映射。
- 运行级临时配置覆写：`configOverrides`
  用于模拟单次执行时传入的配置覆写字典。
- 初始状态字典：`state`
  初始化预置的状态键值映射。
- 底层存储引擎：`storage`
  可选注入的自定义内存存储实例（默认使用 `MemoryStorage`）。
- 日志记录器：`logger`
  可选注入的日志记录器实例（默认使用 `MemoryLogger`）。
- 运行时平台实例：`platform`
  可选注入的标准运行时平台实例。

---

## TestRuntime 实例接口

`createTestRuntime` 返回的运行时对象暴露以下核心执行与插桩方法：

### 直接解包执行：runtime.run

执行指定 Action 并直接返回业务输出数据。如果执行发生错误、模式校验失败或超时，直接抛出 `ActionRuntimeError`：

```ts
const output = await runtime.run<TOutput>(action, input);
```

参数与返回值：
- `action`：动作标识符字符串或通过 `defineAction` 定义的动作对象。
- `input`：符合动作输入模式的传参数据。
- 返回值：Promise 解析为业务输出数据对象。

### 信封包装执行：runtime.execute

执行指定 Action 并返回结构完整的执行信封，无论成功或失败均不抛出未捕获异常，便于断言结构化错误码：

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
  绑定的 `FakeClock` 实例，提供精确的时间快进与单调时间控制。
- 进程模拟器：`runtime.process`
  绑定的 `MockProcessExecutor` 实例，用于注册外部命令模拟规则与审查调用历史。
- 测试配置管理器：`runtime.config`
  提供 `get(key)`、`set(key, value)` 与 `list()` 方法，在测试中动态变更配置。
- 测试状态库：`runtime.state`
  提供 `get(key)`、`set(key, value, ttl?)`、`keys()` 与 `scope(ns)` 方法，检查持久化数据。
- 内存存储实例：`runtime.storage`
  底层纯内存存储驱动 `MemoryStorage`。
- 日志收集器：`runtime.logger`
  纯内存日志记录器，支持断言日志记录条目。
- 生命周期事件流：`runtime.events`
  记录 Action 执行生命周期产生的事件流，支持断言事件派发时序。

---

## 确定性虚拟时钟：FakeClock

`FakeClock` 彻底解耦物理时间推进，实现对超时测试与异步休眠的精确单调推进：

```ts
import { FakeClock } from "@actiondock/testing";

const clock = new FakeClock({
  now: "2026-01-01T00:00:00.000Z", // 初始时间戳、日期字符串或 Date 对象
  startMonotonic: 0,                // 初始单调时间戳毫秒数（默认 0）
});
```

方法与属性契约：

- 获取当前虚拟墙上时间：`clock.now(): Date`
  返回当前时刻的 Date 对象。
- 获取当前虚拟单调时间戳：`clock.monotonic(): number`
  返回不受墙上时间跳变影响的单调递增毫秒时间戳。
- 异步等待虚拟时间：`await clock.sleep(ms: number): Promise<void>`
  创建等待项，仅在调用 `advance` 推进时间跨过目标时刻后解析。
- 快进虚拟时间：`await clock.advance(ms: number): Promise<void>`
  手动向前推进指定毫秒数，按时间戳严格递增顺序触发并完成所有到期的休眠等待。推进负数将抛出异常。
- 等待中的计时器数量：`clock.pendingCount: number`
  当前正处于挂起等待状态的休眠项数量。
- 清理所有计时器：`clock.clear(): void`
  取消并拒绝所有尚未完成的休眠等待项。

---

## 进程执行模拟器：MockProcessExecutor

`MockProcessExecutor` 拦截动作通过 `ctx.process` 发起的所有操作系统命令与受管进程调用，内置 `ProcessManager` 与 `FakeProcessDriver`，在纯内存环境中支撑从简单命令模拟到受管进程全流程测试：

```ts
import { MockProcessExecutor, FakeProcessDriver } from "@actiondock/testing";

const executor = new MockProcessExecutor({
  fallbackToReal: false, // 未命中规则时是否回退到真实子进程（默认 false，直接抛错防穿透）
  driver: new FakeProcessDriver(), // 可选注入自定义测试驱动桩
});
```

方法与属性契约：

- 注册模拟响应规则：`executor.register(matcher, handlerOrResult): this`
  注册匹配器与对应的模拟结果或动态处理函数：
  - `matcher`：匹配规则，支持命令字符串（命令名精确匹配或完整命令行精确匹配）、正则表达式或自定义谓词函数 `(command, args, options) => boolean`。
  - `handlerOrResult`：预设结果对象 `MockProcessResultOptions`（包含 `ok`、`stdout`、`stderr`、`exitCode`、`timedOut`、`cancelled`、`delayMs`、`error`）或动态处理函数。
  ```ts
  executor.register("git status", {
    ok: true,
    stdout: "On branch main\nnothing to commit",
    exitCode: 0,
  });

  executor.register(/^docker/, (cmd, args) => ({
    ok: false,
    exitCode: 1,
    stderr: `Command '${cmd} ${args.join(" ")}' failed`,
  }));
  ```
- 访问底层受管驱动与管理器：
  - `executor.driver`：访问底层的 `FakeProcessDriver` 实例。
  - `executor.processManager`：访问内核 `ProcessManager` 实例。
- 获取历史调用记录：`executor.getCalls(command?: string): ProcessCall[]`
  返回全部外部命令调用记录列表，支持传入命令名进行过滤。
- 获取最近一次调用：`executor.getLastCall(): ProcessCall | undefined`
  返回最近一次发生的命令调用对象。
- 检查命令是否被调用：`executor.hasCalled(command: string): boolean`
  检查指定命令名称是否在历史调用中出现过。
- 清空调用历史：`executor.clearHistory(): void`
  清空已记录的历史调用列表，保留已注册规则。
- 完全重置：`executor.reset(): void`
  清空所有已注册的模拟规则与历史调用记录。
- 历史调用数组：`executor.calls: ProcessCall[]`
  直接访问包含 `command`、`args`、`options` 与 `timestamp` 的调用数组。

---

## 确定性进程驱动桩：FakeProcessDriver

`FakeProcessDriver` 完整实现 Core 层的 `ProcessDriver` 契约，专为长期受管进程、流式输出、独占控制权与异常注入测试而设计。

```ts
import { FakeProcessDriver } from "@actiondock/testing";

const driver = new FakeProcessDriver({
  pty: true,
  resize: true,
  inputEOF: true,
});
```

### 确定性事件模拟方法

通过返回的句柄实例或驱动方法，精确控制进程在测试中的生命周期事件发射：

- 发射输出数据：`driver.emitOutput(handleOrId, stream, data)`
  向指定流（`stdout`、`stderr`、`pty`）发送文本字符串或原始字节数据。
- 发射退出事件：`driver.emitExit(handleOrId, result)`
  触发进程退出通知，可传入退出码数值或 `{ code, signal }` 结构。
- 发射输出流关闭：`driver.emitOutputClosed(handleOrId, reason)`
  标记标准输出通道关闭，原因包括 `natural`、`drain-timeout` 与 `host-lost`。
- 发射驱动故障：`driver.emitFault(handleOrId, error)`
  向观察者派发非预期驱动层严重错误。

### 故障注入能力

用于验证上层业务与框架在遇到异常时的容灾韧性：

- `driver.simulateSpawnFailure(error)`：注入下一次派生启动异常。遵循平台契约，派生失败时自动依次向观察者通知 `fault`、`exited`（`code: null, signal: null`）与 `outputClosed` 三件套。
- `driver.simulateWriteFailure(error)`：注入下一次数据写入时的异常。
- `driver.simulateResizeFailure(error)`：注入调整终端尺寸时的异常。
- `driver.simulateTerminateFailure(error)`：注入终止进程时的异常。

### 调用历史与断言追踪

驱动内部精确记录所有交互细节，供测试执行后置断言：

- `driver.spawnCalls: RecordedSpawn[]`：记录所有派生请求，包含启动规范 `spec`、观察者与时间戳。
- `driver.writes: RecordedWrite[]`：记录所有写入操作，包含目标句柄与写入字节数据副本。
- `driver.eofCalls: RecordedEOF[]`：记录所有标准输入关闭调用。
- `driver.interruptCalls: RecordedInterrupt[]`：记录所有前台中断调用。
- `driver.resizeCalls: RecordedResize[]`：记录所有终端尺寸变更参数。
- `driver.terminateCalls: RecordedTerminate[]`：记录所有优雅终止请求与宽限期。
- `driver.disposeCalls: RecordedDispose[]`：记录所有进程句柄销毁操作。

### 派生自动响应钩子

通过 `onSpawn` 回调在进程派生瞬间自动触发响应行为：

```ts
driver.onSpawn = (handle, spec, observer) => {
  // 模拟进程立即输出启动标语
  handle.emitOutput("stdout", "service started\n");
};
```

---

## 受管进程测试实战指引

### 测试一次性运行与输出收集

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime, FakeProcessDriver } from "@actiondock/testing";

it("验证一次性命令执行与输出截断", async () => {
  const driver = new FakeProcessDriver();
  driver.onSpawn = (handle) => {
    handle.emitOutput("stdout", "line 1\nline 2\n");
    handle.emitExit(0);
    handle.emitOutputClosed("natural");
  };

  const runtime = createTestRuntime({
    platform: { processDriver: driver } as any,
  });

  const res = await runtime.process.run({
    spec: { executable: "test-cmd", args: [], io: { mode: "pipe" } },
    timeoutMs: 3000,
    maxOutputBytes: 1024,
  });

  assert.equal(res.exit.code, 0);
  assert.equal(res.chunks.length > 0, true);
});
```

### 测试长期交互进程与独占控制

```ts
it("验证长期受管进程的独占写入与读取", async () => {
  const driver = new FakeProcessDriver();

  const runtime = createTestRuntime({
    platform: { processDriver: driver } as any,
  });

  const started = await runtime.process.start({
    requestId: "start-req-1",
    spec: { executable: "sh", args: [], io: { mode: "pipe" } },
  });

  const grant = await runtime.process.acquire(started.process.id, {
    requestId: "acq-1",
    waitMs: 1000,
    ttlMs: 5000,
  });

  // 验证写入记录
  await runtime.process.write(started.process.id, {
    token: grant.token,
    requestId: "write-1",
    data: { encoding: "base64", data: Buffer.from("echo 1\n").toString("base64") },
  });

  assert.equal(driver.writes.length, 1);

  // 模拟输出并游标读取
  driver.emitOutput(started.process.id, "stdout", "1\n");
  const readRes = await runtime.process.read(started.process.id, {
    cursor: started.initialCursor,
    maxBytes: 1024,
    waitMs: 100,
    onGap: "error",
  });

  assert.equal(readRes.chunks.length, 1);
});
```

---

## 内存持久化存储：MemoryStorage

`MemoryStorage` 在内存中模拟生产环境的 SQLite 存储行为，提供一致的键值操作与过期淘汰逻辑：

- 强隔离命名空间：各包与动作的状态在内存中通过命名空间进行物理隔离。
- 虚拟时钟联动淘汰：当关联的虚拟时钟推进时，已过期的键值自动被判定为无效并物理清理。
- 零磁盘持久化开销：测试执行完毕后自动被垃圾回收机制释放，彻底杜绝测试遗留临时文件。

---

## 运行时异常类：ActionRuntimeError

当使用 `runtime.run()` 执行失败时抛出的规范异常类：

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
  assert.fail("应当抛出模式校验异常");
} catch (err) {
  assert.ok(err instanceof ActionRuntimeError);
  assert.equal(err.code, "INPUT_VALIDATION_FAILED");
}
```
