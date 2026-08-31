# 参考手册：Action SDK API (@actiondock/sdk)

`@actiondock/sdk` 是编写 ActionDock Action 与单元测试的核心轻量库。

---

## 1. `defineAction`

声明一个标准 Action 定义：

```ts
function defineAction<TInput = any, TOutput = any>(
  def: ActionDefinition<TInput, TOutput>
): ActionDefinition<TInput, TOutput>;
```

### `ActionDefinition` 接口
```ts
export interface ActionDefinition<TInput = any, TOutput = any> {
  /** 全局唯一 Action 标识符（如 github.get-pr） */
  id: string;

  /** 面向人类与 LLM 的功能描述 */
  description: string;

  /** 入参 JSON Schema（用于 Ajv 校验与 MCP Tool 发现） */
  inputSchema: Record<string, any>;

  /** 出参 JSON Schema（用于 Ajv 校验与类型保证） */
  outputSchema?: Record<string, any>;

  /** 核心执行逻辑函数 */
  run(input: TInput, ctx: ActionContext): Promise<TOutput>;
}
```

---

## 2. `ActionContext` 接口

```ts
export interface ActionContext {
  /** 5 级优先级配置存储 */
  config: ConfigStore;

  /** SQLite 状态持久化存储 */
  state: StateStore;

  /** Action 间级联调用器（带循环调用保护） */
  actions: ActionInvoker;

  /** 隔离写入 stderr 的结构化日志记录器 */
  log: Logger;

  /** 协作式取消信号 */
  signal?: AbortSignal;
}
```

### `ConfigStore`
```ts
export interface ConfigStore {
  get<T = any>(key: string, defaultValue?: T): T | undefined;
}
```

### `StateStore`
```ts
export interface StateStore {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: any, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<Record<string, any>>;
  namespace(ns: string): StateStore;
}
```

### `ActionInvoker`
```ts
export interface ActionInvoker {
  invoke<TInput = any, TOutput = any>(
    actionId: string,
    input?: TInput,
    options?: { config?: Record<string, any> }
  ): Promise<TOutput>;
}
```

### `Logger`
```ts
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
```

---

## 3. `createTestRuntime`

创建极速纯内存测试沙箱：

```ts
function createTestRuntime(options?: TestRuntimeOptions): TestRuntime;

export interface TestRuntimeOptions {
  config?: Record<string, any>;
  initialState?: Record<string, any>;
  actions?: Record<string, ActionDefinition<any, any>>;
}

export interface TestRuntime {
  execute<TInput, TOutput>(
    action: ActionDefinition<TInput, TOutput>,
    input: TInput
  ): Promise<TOutput>;
  state: StateStore;
  logs: Array<{ level: string; message: string; timestamp: string }>;
}
```
