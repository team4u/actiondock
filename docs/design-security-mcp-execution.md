# ActionDock 2.0 安全加固、MCP Adapter 与执行生命周期设计

- **状态**：Implemented
- **目标分支**：`refactor/v2.0`
- **核心定位**：确立 ActionDock 2.0 的安全底线、Model Context Protocol (MCP) 适配器规范与完整的执行生命周期（Timeout / Cancel / Async Task）。

---

## 1. 架构原则

1. **`ActionRunner` 是唯一执行核心**：无论是 CLI、HTTP Runner 还是 MCP Server，所有调用最终统一流经 `ActionRunner`。
2. **MCP 不实现第二套 Runtime**：MCP Tool 调用直接映射为 Action 执行，Schema 自动转换，执行历史无缝写入 SQLite `runs` 表。
3. **HTTP API 不实现第二套任务状态**：统一复用 SQLite `runs` 数据模型与 `runId` 标识，`runId` 等价于任务句柄。
4. **统一执行上下文与取消信号**：在 `ActionContext` 中引入标准 Web API `AbortSignal`（`ctx.signal`），实现跨协议协作式取消。
5. **安全默认（Secure by Default）**：网络监听默认绑定 `127.0.0.1`，公网暴露强制鉴权，移除 URL Query Token，默认关闭跨域，敏感文件应用最小文件权限。

```text
                  ActionDefinition
                          │
                          ▼
                     ActionRunner
                          │
               ┌──────────┴──────────┐
               │                     │
          RuntimeStorage       ExecutionManager
              SQLite            AbortController
               │                     │
               └──────────┬──────────┘
                          │
      ┌───────────────────┼──────────────────┐
      │                   │                  │
     CLI                HTTP                MCP
      │                   │                  │
   execute()          start/execute       tools/call
      │                   │                  │
      └───────────────────┴──────────────────┘
                          │
                     action.run()
                          │
                     ActionContext
                          │
   ┌────────┬────────┬────────┬─────────────┐
 config    state   actions    log         signal
```

---

## 2. Part 1：HTTP Runner 安全加固 (Security Hardening)

### 2.1 默认绑定与非 Loopback 强制认证
* **默认监听**：`ac serve` 与 `ac mcp serve` 默认仅绑定 `127.0.0.1`。
* **强制鉴权**：当绑定到 `0.0.0.0` 或非 Loopback 地址时，若未配置 `--token` 或 `ACTIONDOCK_TOKEN`，服务拒绝启动；若确需在私网内无密码运行，必须显式传入 `--allow-insecure-no-auth`。

### 2.2 移除 URL Query Token 与时间安全比较
* 彻底移除 `?token=xxx` URL 参数认证支持，防止 Token 被代理日志、访问日志或浏览器历史泄露；仅允许 `Authorization: Bearer <token>` 请求头。
* 采用 `crypto.timingSafeEqual` 进行恒定时间比较，防止针对 Token 的时序侧信道攻击。

### 2.3 CORS 默认关闭与白名单机制
* 默认不返回 `Access-Control-Allow-Origin` 响应头，阻止任意网页跨域调用本地 Runner。
* 仅当通过 `--cors-origin <url>` 显式指定时，才按白名单返回对应 CORS 标头。

### 2.4 请求 Body 限制与调试信息隐藏
* 默认请求 Body 最大限制为 `1 MiB`（可通过 `--max-body` 调整），超出时返回 `413 REQUEST_TOO_LARGE`。
* `GET /api/v1/health` 与 `GET /api/v1/info` 默认不返回宿主机绝对路径 `projectRoot`，仅在传入 `--expose-debug-info` 时用于开发调试展示。

### 2.5 Profile TokenEnv 与文件权限加固
* Profile 推荐使用 `--token-env <ENV_NAME>` 关联环境变量名，避免在 `~/.actiondock/profiles.json` 中明文持久化 Token。
* 配置文件与 SQLite 数据文件在 POSIX 系统上强制应用 `0o600` 文件权限与 `0o700` 目录权限。

---

## 3. Part 2：Model Context Protocol (MCP) 适配器

ActionDock 2.0 在 `packages/mcp`（`@actiondock/mcp`）中实现了官方 MCP 规范：

### 3.1 Schema 零冗余映射
* 基于 `@modelcontextprotocol/server`，将 Action 的 JSON Schema 转换为标准 MCP Tool Input/Output Schema。
* 无需单独维护 MCP 工具清单，项目中定义的所有 Action 自动暴露为 MCP Tools。

### 3.2 双模 Transport
* **STDIO 模式 (`ac mcp`)**：标准输入输出通信，适用于 Claude Code、Cursor、VS Code 等本地 Agent / 桌面 IDE 直连。
* **Streamable HTTP 模式 (`ac mcp serve`)**：标准 HTTP 通信（端点 `/mcp`），适用于微服务或容器化远程部署。

### 3.3 双向取消链路
* MCP 客户端发出的取消请求（`ctx.mcpReq.signal`）无缝传递给 `ActionRunner`，并最终注入 Action 的 `ctx.signal`，实现跨协议协作取消。

---

## 4. Part 3：执行生命周期、超时与异步任务 (Execution Lifecycle)

### 4.1 `ActionContext.signal`
* 在 `ActionContext` 中引入 `signal: AbortSignal`，向下兼容旧 Action（无需修改即可执行），支持新 Action 响应式感知取消与超时。
* 支持在 Action 中透传给 `fetch(url, { signal: ctx.signal })` 或调用 `ctx.signal.throwIfAborted()`。

### 4.2 `ActionRunner.start()` 与 `ExecutionHandle`
* 拆分基础执行原语：
  ```ts
  export interface ExecutionHandle {
    runId: string;
    result: Promise<ExecutionResult>;
    cancel(reason?: string): boolean;
  }
  ```
* `runner.start(...)` 立即返回 `ExecutionHandle` 与 `runId`，用于后台异步任务调度与内存生命周期控制。
* `runner.execute(...)` 等价于 `runner.start(...).result`，完全保持原有同步调用的向后兼容。

### 4.3 `ExecutionManager`
* 内存中活跃任务句柄注册表，追踪当前 Node/Bun 进程中正在执行中的 Action Promise。
* 提供 `register`、`get`、`cancel`、`list` 与 `clear` 操作，当 Action 执行完成（无论成功或失败）自动注销。

### 4.4 超时机制与终态保证
* 传入 `timeoutMs` 时，`ActionRunner` 创建计时器并在超时时触发内部 `AbortController.abort()`。
* 执行流程通过 `Promise.race([actionPromise, abortPromise])` 竞速。超时统一归类为终态 `status = "failed"`，错误码为 `ACTION_TIMEOUT`。
* 主动取消归类为终态 `status = "cancelled"`，错误码为 `ACTION_CANCELLED`。
* 内部设立 `finalized` 幂等标志，防止因底层非协作式 JS 耗时导致的“迟到 Promise”二次覆写 `RunRecord`。

### 4.5 子 Action 取消信号向下传播
* 复合 Action 中调用 `ctx.actions.invoke(childAction, input)` 时，子 Action 会自动继承父 Action 的 `AbortSignal`，确保取消链路层层穿透。

### 4.6 HTTP 异步执行与长生命周期 Registry
* **`ServerRuntimeRegistry`**：持有共享的 `RuntimeStorage` 实例与 `ExecutionManager`，避免在请求返回 `202 Accepted` 时提前关闭 SQLite 连接。
* **异步接口**：
  * `POST /api/v1/actions/:id/run` 传入 `{ "execution": { "mode": "async", "timeoutMs": ... } }` 时立即返回 `202 Accepted { ok: true, runId, status: "running" }`。
  * `GET /api/v1/runs/:runId`：查询指定 Run 记录。
  * `POST /api/v1/runs/:runId/cancel`：取消指定运行中的任务。

### 4.7 门面层契约与边界
* **CLI (`ac run`)**：
  * 支持 `--timeout <duration>`（如 `500ms`、`30s`、`5m`、`1h`）。
  * 捕获终端 `SIGINT` (`Ctrl+C`) 并传播到 `runner.execute`。
  * 本地单进程执行时严格拒绝 `--async`，提示使用 `--profile` 或 `ac serve`。
* **CLI Runs (`ac runs`)**：
  * `ac runs show <id>` 支持通过 `--profile` 或 `--server` 查询远程运行记录。
  * `ac runs cancel <id>` 仅允许对远程目标执行，本地执行时明确报错拦截。
* **Standalone 独立二进制**：
  * 支持 `--timeout` 与 `Ctrl+C` 信号。
  * 严格拒绝 `--async` 与跨进程 cancel。
* **Server-lifetime Execution 保证**：
  * 第一阶段异步执行模型定义为 **Server-lifetime Asynchronous Execution**：Run 元数据持久化在 SQLite 中，执行生命周期绑定当前长运行的 `ac serve` 进程（不内建分布式重型队列与重启自动恢复）。

---

## 5. 验收标准清单

- [x] **S01**：`ac serve` 默认只监听 `127.0.0.1`。
- [x] **S02**：`0.0.0.0` 且无 Token 启动失败。
- [x] **S03**：`0.0.0.0` 且有 Token 启动成功。
- [x] **S04**：URL `?token=xxx` 请求返回 401。
- [x] **S05**：`Authorization: Bearer <token>` 验证成功。
- [x] **S06**：默认不返回 `Access-Control-Allow-Origin`。
- [x] **S07**：配置 `--cors-origin` 后按白名单返回。
- [x] **S08**：超大 Body 返回 413 `REQUEST_TOO_LARGE`。
- [x] **S09**：默认不暴露 `projectRoot` 宿主机绝对路径。
- [x] **S10**：Profile 支持 `tokenEnv` 并应用 `0o600` 文件权限。
- [x] **E01**：旧 Action 零修改平滑运行，新 Action 可读取 `ctx.signal`。
- [x] **E02**：CLI 与 Standalone 支持 `--timeout`，超时记录为 `ACTION_TIMEOUT`。
- [x] **E03**：CLI 捕获 `Ctrl+C` 传播取消信号，记录为 `ACTION_CANCELLED`。
- [x] **E04**：HTTP Server 支持 `mode = "async"` 返回 `202 Accepted`。
- [x] **E05**：HTTP Server 提供 `GET /api/v1/runs/:id` 与 `POST /api/v1/runs/:id/cancel`。
- [x] **E06**：`ac runs show` 与 `ac runs cancel` 支持 `--profile` 远程操作。
- [x] **E07**：本地单次执行严格拒绝 `--async` 与 `ac runs cancel` 并提供明确指引。
- [x] **M01**：MCP Tools 自动映射自 ActionDefinition，Schema 零冗余。
- [x] **M02**：MCP 调用统一经由 `ActionRunner` 并写入 SQLite `runs`。
- [x] **M03**：MCP 客户端取消直通 Action 内部 `ctx.signal`。
- [x] **M04**：MCP STDIO 与 HTTP Transport 具备一致的安全与执行语义。
