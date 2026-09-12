# 参考手册：Action SDK API

[`@actiondock/sdk`](../../packages/sdk/README.md) 是编写 ActionDock Action 的基础核心包，提供 Action 定义方法、契约接口与运行时上下文环境。

---

## `defineAction` 动作定义方法

用于声明 Action 业务执行处理函数：

```ts
import { defineAction, type ActionDefinition, type ActionHandler } from "@actiondock/sdk";

// 直接传入处理函数
export default defineAction<TInput, TOutput>(async (input, ctx) => {
  return { ... };
});

// 传入包含 run 方法的定义对象
export default defineAction<TInput, TOutput>({
  async run(input, ctx) {
    return { ... };
  },
});
```

### ActionDefinition 契约规范

在 ActionDock 2.0 中，`actiondock.json` 是元数据的权威事实源。`ActionDefinition` 仍保留代码内元数据字段用于兼容和编程式调用场景，新项目推荐将元数据统一声明在清单中：

```ts
export interface ActionDefinition<I = unknown, O = unknown> {
  /**
   * Action 核心业务逻辑执行函数
   * @param input 符合输入模式约束的入参数据
   * @param ctx 运行时上下文对象
   */
  run(input: I, ctx: ActionContext): Promise<O> | O;
  /** Action 唯一标识 */
  id?: string;
  /** Action 功能描述 */
  description?: string;
  /** 输入参数模式规范 */
  inputSchema?: JsonSchema;
  /** 输出结果模式规范 */
  outputSchema?: JsonSchema;
  /** 静态 Action 依赖列表 */
  uses?: string[];
  /** 检索与分类标签 */
  tags?: string[];
  /** 协议注解元数据 */
  annotations?: Record<string, JsonValue>;
}
```

---

## `ActionContext` 运行时上下文

每次执行 Action 时，底层运行时引擎均向 `run` 方法传入全新的 `ActionContext` 实例：

```ts
export interface ActionContext {
  /** 配置读取接口，遵循多级回退策略 */
  config: Config;
  /** 状态持久化存储接口，具备命名空间与存活时间支持 */
  state: StateStore;
  /** Action 相互调用接口，内置调用栈深度与环路保护 */
  actions: ActionInvoker;
  /** 统一受管外部进程操作接口 */
  process: ProcessAPI;
  /** 结构化日志接口，输出至标准错误流以实现通道隔离 */
  log: Logger;
  /** 执行进度报告接口 */
  progress: ProgressReporter;
  /** 协作式取消信号，透传 AbortSignal */
  signal: AbortSignal;
  /** 当前执行链路的唯一标识与元数据 */
  run: {
    /** 本次 Action 执行的唯一标识 */
    id: string;
    /** 根任务执行标识，跨嵌套调用链路保持一致 */
    rootId: string;
    /** 直接父级 Action 执行标识（若存在） */
    parentId?: string;
  };
}
```

---

## 核心子接口详解

### 配置读取接口 `Config`

支持多级回退机制（单次调用覆盖 > 包级持久存储 > 环境变量与配置文件 > 清单默认声明 > 内联默认值）：

```ts
export interface Config {
  /**
   * 读取指定键的配置值，若未配置则返回 undefined
   * @param key 配置键名
   */
  get<T = unknown>(key: string): T | undefined;

  /**
   * 读取指定键的配置值，若未配置则返回指定的默认值
   * @param key 配置键名
   * @param defaultValue 回退默认值
   */
  get<T = unknown>(key: string, defaultValue: T): T;

  /**
   * 检查指定键名是否存在有效配置
   * @param key 配置键名
   */
  has(key: string): boolean;
}
```

---

### 状态持久化存储接口 `StateStore`

基于包级独立的 SQLite 存储引擎，支持存活时间自动失效与命名空间隔离：

```ts
export interface StateStore {
  /**
   * 读取指定键的状态值；若该键已超时失效则返回 undefined
   * @param key 状态键名
   */
  get<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * 写入状态键值对，可选指定存活时间
   * @param key 状态键名
   * @param value 需存储的数据对象
   * @param ttl 存活秒数；不传或小于等于 0 表示永久有效
   */
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * 删除指定键的状态数据
   * @param key 状态键名
   */
  delete(key: string): Promise<boolean>;

  /**
   * 清空当前命名空间下的状态数据，支持按前缀过滤
   * @param prefix 可选的键名前缀过滤项
   */
  clear(prefix?: string): Promise<number>;

  /**
   * 列出当前命名空间下所有匹配前缀的键名列表
   * @param prefix 可选的键名前缀过滤项
   */
  keys(prefix?: string): Promise<string[]>;

  /**
   * 派生具有独立命名空间隔离的子 StateStore 实例
   * @param namespace 命名空间名称
   */
  scope(namespace: string): StateStore;
}
```

---

### Action 互调接口 `ActionInvoker`

支持 Action 之间的安全调用，运行时自动校验依赖声明并维护调用栈深度与环路保护：

```ts
export interface ActionInvoker {
  /**
   * 直接调用指定的 Action
   * @param ref 目标 Action 引用或标识符
   * @param input 传递给目标 Action 的输入参数
   */
  (ref: string | ActionRef, input?: unknown): Promise<unknown>;

  /**
   * 调用指定的 Action 并传入参数，返回其执行结果
   * @param action 目标 Action 引用或标识符
   * @param input 传递给目标 Action 的输入参数
   */
  invoke<I = unknown, O = unknown>(
    action: ActionRef | string,
    input?: I
  ): Promise<O>;
}

export interface ActionRef {
  /** 所属包标识（可选） */
  packageId?: string;
  /** Action 动作标识 */
  actionId: string;
}
```

#### 调用参数约束与禁止事项
- 仅接受标识符与引用：`ctx.actions.invoke` 严格只接受动作标识符字符串（短标识符如 `"greet"` 或跨包限定标识符如 `"shared-pkg/b"`）或 `ActionRef` 引用对象。
- 禁止传入动作定义对象：**严禁将 ActionDefinition 对象或裸函数传入 ctx.actions.invoke**。传入定义对象将绕过 `actiondock.json` 清单校验、模式规范检查与子运行链路记录，执行引擎将抛出 `INVALID_ACTION_REF` 错误。
- 依赖必须显式声明：所有通过 `ctx.actions.invoke` 发起的级联调用，必须在当前包 `actiondock.json` 的 `uses` 列表中显式声明。未声明的调用将返回 `UNDECLARED_ACTION_DEPENDENCY` 错误。
- 循环调用防护：当检测到相互调用成环时，执行引擎抛出 `ACTION_CALL_CYCLE` 错误。

---

### 统一受管外部进程接口 `ProcessAPI`

ActionDock 2.0 严格规范受管进程调用，`ProcessAPI` 仅提供 `exec` 与 `spawn` 两个方法（彻底移除了旧版的 `spawnDetached`、`execCli` 与 `findExecutable`）：

```ts
export interface ProcessAPI {
  /** 执行外部命令并返回标准化执行结果 */
  exec(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>;

  /** 启动外部命令进程并返回标准化执行结果 */
  spawn(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>;
}
```

#### 选项参数 `ProcessExecOptions`
```ts
export interface ProcessExecOptions {
  /** 子进程执行的工作目录（默认当前工作目录） */
  cwd?: string;
  /** 注入子进程的环境变量映射 */
  env?: Record<string, string>;
  /** 写入子进程标准输入的文本或字节流 */
  input?: string | Uint8Array;
  /** 单次执行超时毫秒数；超时将触发终止信号并置位 timedOut */
  timeoutMs?: number;
  /** 协作式取消信号（可传入 ctx.signal） */
  signal?: AbortSignal;
  /** 输出字符解码编码（默认 utf-8） */
  encoding?: string;
  /** 退出码非 0 时是否直接抛出异常（默认 false） */
  throwOnError?: boolean;
  /** 允许缓冲的最大输出字节数，防止内存耗尽 */
  maxOutputBytes?: number;
}
```

#### 返回结果 `ProcessResult`
```ts
export interface ProcessResult {
  /** 命令是否成功结束（退出码为 0 且未超时或取消） */
  ok: boolean;
  /** 进程退出状态码（异常中断时为 null） */
  exitCode: number | null;
  /** 导致进程退出的信号名称（如 SIGTERM） */
  signal?: string;
  /** 标准输出文本 */
  stdout: string;
  /** 标准错误文本 */
  stderr: string;
  /** 原始字节数组输出 */
  raw: Uint8Array;
  /** 是否因超时被终止 */
  timedOut: boolean;
  /** 是否因 AbortSignal 触发被取消 */
  cancelled: boolean;
  /** 命令执行耗时（毫秒） */
  durationMs: number;
  /** 结构化运行时错误详情（若失败） */
  error?: RuntimeError;
}
```

#### 使用示例
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction(async (_input, ctx) => {
  const res = await ctx.process.exec("git", ["log", "-1", "--format=%H %s"], {
    timeoutMs: 5000,
    signal: ctx.signal,
  });

  if (!res.ok) {
    ctx.log.error(`Git 执行失败: ${res.stderr}`);
    return { commit: null };
  }

  return { commit: res.stdout.trim() };
});
```

---

### 结构化日志接口 `Logger`

日志物理定向输出至标准错误流，避免污染标准输出的数据流：

```ts
export interface Logger {
  /** 记录调试级别日志 */
  debug(message: string, data?: unknown): void;
  /** 记录信息级别日志 */
  info(message: string, data?: unknown): void;
  /** 记录警告级别日志 */
  warn(message: string, data?: unknown): void;
  /** 记录错误级别日志 */
  error(message: string, data?: unknown): void;
}
```

---

### 任务进度报告接口 `ProgressReporter`

在耗时任务中向订阅者推送阶段进度：

```ts
export interface ProgressReporter {
  /**
   * 报告当前任务执行进度
   * @param current 当前已完成的工作量数值
   * @param total 任务预期总量数值（可选）
   * @param message 当前步骤阶段的文字说明（可选）
   */
  report(current: number, total?: number, message?: string): void;
}
```
