# 参考手册：Testing 测试框架 API

`@actiondock/testing` 是 ActionDock 官方测试框架。它提供纯内存测试沙箱、虚拟时钟与进程拦截模拟。测试框架完全对齐 Node.js 原生测试标准。

---

## 核心导出函数：createTestRuntime

用于初始化纯内存测试运行时：

```ts
import { createTestRuntime, type TestRuntimeOptions } from "@actiondock/testing";

const runtime = createTestRuntime(options?: TestRuntimeOptions);
```

### TestRuntimeOptions 配置项

- 清单项目配置：`projectConfig`
  模拟清单定义，包含 `id`、`config`、`actions` 与模式约束。
- 包标识：`packageId`
  指定当前测试沙箱执行的包标识符。缺省时使用 `projectConfig.id`。
- 动作注册表：`actions`
  动作标识符与实现的映射字典。支持对象、数组或 Map。
- 动作模拟器实例：`actionsMock`
  可选注入的 `MockActionInvoker` 实例。缺省时自动生成独立的新实例。
- 自定义虚拟时钟：`clock`
  传入自定义的 `FakeClock` 实例。缺省时自动生成独立的新时钟。
- 模拟进程执行器：`process`
  传入自定义的 `MockProcessExecutor` 实例。缺省时自动生成全新实例。
- 初始配置字典：`config`
  初始化注入的配置键值映射。
- 执行级临时配置覆写：`configOverrides`
  用于模拟单次执行时传入的配置覆写字典。
- 初始状态字典：`state`
  初始化预置的状态键值映射。
- 底层存储引擎：`storage`
  可选注入的自定义内存存储实例（默认使用 `MemoryStorage`）。
- 日志记录器：`logger`
  可选注入的日志记录器实例（默认使用 `MemoryLogger`）。
- 运行时平台实例：`platform`
  可选注入时钟与存储等平台能力。动作调用目标端口由测试运行时管理。平台不得预置 `invocationTargets`。自定义目标集成测试应使用 `createActionDock`。

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

执行指定 Action 并返回执行信封。无论成功或失败均不抛出未捕获错误。该方法便于断言结构化错误码：

```ts
const envelope = await runtime.execute(action, input, options?: RunOptions);

if (envelope.ok) {
  console.log("执行成功:", envelope.data);
} else {
  console.error("执行失败:", envelope.error.code, envelope.error.message);
}
```

### 插桩属性说明

- 动作调用模拟器：`runtime.actions`
  绑定的 `MockActionInvoker` 实例，用于注册下游模拟规则并断言调用时序。
- 确定性虚拟时钟：`runtime.clock`
  绑定的 `FakeClock` 实例，提供精确的时间快进与单调时间控制。
- 进程模拟器：`runtime.process`
  绑定的 `MockProcessExecutor` 实例，用于注册命令模拟规则。
- 测试配置管理器：`runtime.config`
  提供 `get(key)`、`set(key, value)` 与 `list()` 方法，在测试中动态修改配置。
- 测试状态库：`runtime.state`
  提供 `get(key)`、`set(key, value, ttl?)`、`keys()` 与 `scope(ns)` 方法，校验持久化数据。
- 内存存储实例：`runtime.storage`
  底层纯内存存储驱动 `MemoryStorage`。
- 日志收集器：`runtime.logger`
  纯内存日志记录器，支持断言日志记录条目。
- 生命周期事件流：`runtime.events`
  记录 Action 执行生命周期产生的事件流，支持断言事件派发时序。

---

## 动作调用模拟器：MockActionInvoker

`MockActionInvoker` 为测试环境提供 Action 调用的拦截与模拟。它支持多目标命名绑定模拟、快照存储与审查能力：

```ts
import { MockActionInvoker, type MockActionCall, type MockActionOptions } from "@actiondock/testing";

const invoker = new MockActionInvoker("order-pkg");
// 可选第二参数传入 Clock，统一调用记录的时间来源。
```

### MockActionOptions 配置项

- 命名绑定名称：`binding?: string`
  指定匹配的命名绑定。缺省或显式传入 `"default"` 等价。指定其他绑定时精确匹配。未命中的调用直接拦截并抛出错误，不回退到默认绑定。
- 契约约束定义：`contract?: MockActionContract`
  包含可选的输入模式 `inputSchema`、输出模式 `outputSchema` 与依赖声明 `uses?: string[]`。

### MockActionCall 调用记录模型

每次模拟调用触发时，系统深拷贝入参并生成调用快照记录：

- 规范化动作引用：`ref: string`，例如 `"pricing/quote"`。
- 命中命名绑定：`binding: string`，缺省时记录为 `"default"`。
- 入参深拷贝快照：`input: unknown`，保证后续变异不污染断言数据。
- 子任务执行标识：`runId?: string`，当前调用的执行标识。
- 根任务执行标识：`rootRunId?: string`，调用链最顶层根任务标识。
- 调用发生时间戳：`timestamp: number`，毫秒时间戳。

### 核心方法与属性

- 注册持续模拟规则：`invoker.register(ref, handlerOrJsonResult, options?): this`
  注册持久生效的模拟规则。`handlerOrJsonResult` 可为处理函数，或返回的静态结果对象。
- 注册一次性模拟规则：`invoker.registerOnce(ref, handlerOrJsonResult, options?): this`
  注册先进先出的一次性响应规则。多次注册按顺序消费。队列耗尽后由持续规则接替。无持续规则时再次调用失败并抛出错误。
- 获取调用记录列表：`invoker.calls: readonly MockActionCall[]`
  返回调用记录的独立快照，修改返回值不污染内部历史。
- 条件筛选调用记录：`invoker.getCalls(ref?, options?: { binding?: string }): MockActionCall[]`
  支持根据动作引用与绑定名称组合筛选历史记录。
- 仅清理历史记录：`invoker.clearHistory(): void`
  仅清空调用历史，保留所有已注册规则。
- 完全重置模拟器：`invoker.reset(): void`
  清空所有调用历史与已注册规则，并单调递增版本号。
- 规则版本序号：`invoker.revision: number`
  单调递增的版本计数器。注册或重置规则时自增。该计数器通知运行时刷新缓存，使替换立即生效。

### 运行时契约与安全边界

- 真实上下文执行：处理函数 `handler(input, ctx)` 接收真实 `ActionContext`。函数可抛出特定的 `ActionDockError` 或 `Error`。执行引擎走真实 `ActionRunner` 流程并保留最终错误代码。
- 真实内核管道保障：模拟调用走真实 `ActionRunner` 校验链路。包括模式校验、依赖授权、取消信号传递、执行深度校验与调用环路检测。
- 显式依赖授权约束：测试框架不自动补齐 `uses`。跨包及独立目标调用缺少声明时在入口拒绝。模拟函数不会执行。同包调用保持豁免。
- 模拟动作自身依赖声明：模拟动作跨包调用其他动作时，同样必须在 `contract.uses` 中声明权限。
- 本地替身混合支持：支持通过 `options.actions` 注册本地真实替身动作，与具名模拟动作混合执行。
- 安全隔离与集成测试边界：模拟规则完全在内存中拦截。未命中的调用严禁穿透访问远端。单测模拟不能证明实际的 HTTP 鉴权可用，仍需启动服务测试。

---

## 确定性虚拟时钟：FakeClock

`FakeClock` 隔离物理时间推进，实现对超时测试与异步休眠的精确单调推进：

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
  生成等待项，仅在推进时间跨过目标时刻后解析。
- 快进虚拟时间：`await clock.advance(ms: number): Promise<void>`
  手动向前推进指定毫秒数，按时间戳递增顺序触发所有休眠等待。推进负数将抛出错误。
- 等待中的计时器数量：`clock.pendingCount: number`
  当前处于挂起等待状态的休眠项数量。
- 清理所有计时器：`clock.clear(): void`
  取消所有尚未完成的休眠等待项。

---

## 进程执行模拟器：MockProcessExecutor

`MockProcessExecutor` 拦截通过 `ctx.process` 发起的系统命令与受管进程调用。内置 `ProcessManager` 与 `FakeProcessDriver`，在内存中支撑命令模拟与测试：

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
  - `matcher`：匹配规则。支持命令字符串、正则表达式或自定义函数。
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
- 校验命令调用记录：`executor.hasCalled(command: string): boolean`
  校验指定命令名称是否在历史调用中出现过。
- 清空调用历史：`executor.clearHistory(): void`
  清空已记录的历史调用列表，保留已注册规则。
- 完全重置：`executor.reset(): void`
  清空所有已注册的模拟规则与历史调用记录。
- 历史调用数组：`executor.calls: ProcessCall[]`
  直接访问包含 `command`、`args`、`options` 与 `timestamp` 的调用数组。

---

## 确定性进程驱动桩：FakeProcessDriver

`FakeProcessDriver` 完整实现 Core 层的 `ProcessDriver` 契约，专为长期受管进程、流式输出与错误注入测试而设计。

```ts
import { FakeProcessDriver } from "@actiondock/testing";

const driver = new FakeProcessDriver({
  pty: true,
  resize: true,
  inputEOF: true,
});
```

### 确定性事件模拟方法

通过返回的句柄实例或驱动方法，控制进程在测试中的生命周期事件发射：

- 发射输出数据：`driver.emitOutput(handleOrId, stream, data)`
  向指定流（`stdout`、`stderr`、`pty`）发送文本字符串或原始字节数据。
- 发射退出事件：`driver.emitExit(handleOrId, result)`
  触发进程退出通知，可传入退出码数值或 `{ code, signal }` 结构。
- 发射输出流关闭：`driver.emitOutputClosed(handleOrId, reason)`
  标记标准输出通道关闭，原因包括 `natural`、`drain-timeout` 与 `host-lost`。
- 发射驱动错误：`driver.emitFault(handleOrId, error)`
  向观察者派发非预期驱动层严重错误。

### 错误注入能力

用于验证上层业务与框架在遇到错误时的容灾韧性：

- `driver.simulateSpawnFailure(error)`：注入下一次派生启动错误。遵循平台契约，派生失败时自动依次向观察者通知 `fault`、`exited`（`code: null, signal: null`）与 `outputClosed`。
- `driver.simulateWriteFailure(error)`：注入下一次数据写入时的错误。
- `driver.simulateResizeFailure(error)`：注入调整终端尺寸时的错误。
- `driver.simulateTerminateFailure(error)`：注入终止进程时的错误。

### 调用历史与断言追踪

驱动内部记录交互细节，供测试执行后置断言：

- `driver.spawnCalls: RecordedSpawn[]`：记录所有派生请求，包含启动规范 `spec`、观察者与时间戳。
- `driver.writes: RecordedWrite[]`：记录所有写入操作，包含目标句柄与写入字节数据副本。
- `driver.eofCalls: RecordedEOF[]`：记录所有标准输入关闭调用。
- `driver.interruptCalls: RecordedInterrupt[]`：记录所有前台中断调用。
- `driver.resizeCalls: RecordedResize[]`：记录所有终端尺寸修改参数。
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

### 测试一次性执行与输出收集

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

  // 验证写入记录
  await runtime.process.write(started.process.id, {
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

`MemoryStorage` 在内存中模拟 SQLite 存储行为，提供一致的键值操作与过期淘汰逻辑：

- 强隔离命名空间：各包与动作的状态在内存中通过命名空间隔离。
- 虚拟时钟联动淘汰：虚拟时钟推进时，系统自动清理已过期的键值。
- 零磁盘持久化开销：测试执行完毕后垃圾回收机制自动释放内存，杜绝遗留临时文件。

---

## 运行时错误类：ActionRuntimeError

当使用 `runtime.run()` 执行失败时抛出的规范错误类：

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
  assert.fail("应当抛出模式校验错误");
} catch (err) {
  assert.ok(err instanceof ActionRuntimeError);
  assert.equal(err.code, "INPUT_VALIDATION_FAILED");
}
```
