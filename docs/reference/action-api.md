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

---

## 4. Action 内执行外部 CLI 规范与防死锁模式

当 Action 需调度系统外部 CLI 命令（如 `agent-browser`、`git`、`docker` 等）时，应遵循以下工程实践：

### 核心注意事项
1. **Windows `.cmd` 路径解析**：npm 全局安装的命令在 Windows 上为 `.cmd` 批处理文件，必须通过 `Bun.which("command")` 解析完整绝对路径后再执行，否则底层 `CreateProcess` 会失败。
2. **防管道死锁（避免异步流阻塞）**：外部子进程（尤其是有头/无头浏览器、Node 子进程）可能会残留打开的 stdout/stderr 句柄，导致 `new Response(proc.stdout).text()` 永久挂起卡死。**调用外部 CLI 统一推荐使用 `Bun.spawnSync`** 一次性同步排空管道。
3. **配套防御机制**：
   - **Timeout 兜底**：防单条命令异常挂死。
   - **取消检测**：在多步命令间检测 `if (ctx.signal?.aborted) throw ...` 及时响应取消。
   - **退出码业务判定**：非零退出码（如探测超时、diff 未命中）应作为业务分支处理，避免盲目抛出异常。

### 推荐的 CLI 封装辅助函数

```ts
export function safeExecCli(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
) {
  const binPath = Bun.which(command);
  if (!binPath) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: `Command '${command}' not found in PATH.`,
    };
  }

  const proc = Bun.spawnSync([binPath, ...args], {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    ok: proc.exitCode === 0,
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}
```

