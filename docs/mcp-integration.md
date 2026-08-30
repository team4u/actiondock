# Model Context Protocol (MCP) 适配器指南

ActionDock 2.0 提供了原生的 **Model Context Protocol (MCP)** 适配器（`@actiondock/mcp`），允许将任意 ActionDock Package 直接暴露为符合标准 MCP 规范的 Tool Server。

---

## 架构与核心设计原则

```text
       Claude Code / Cursor / VS Code (MCP Host)
                          │
            ┌─────────────┴─────────────┐
            │                           │
       STDIO Mode                   HTTP Mode
        (ac mcp)                 (ac mcp serve)
            │                           │
            └─────────────┬─────────────┘
                          │
                  @actiondock/mcp
            (fromJsonSchema Tool Mapping)
                          │
                    ActionRunner
              (Cycle Check / Ajv Schema)
                          │
            ┌─────────────┴─────────────┐
            │                           │
       ActionContext              RuntimeStorage
     (signal / state)             (SQLite runs)
```

1. **唯一执行核心**：MCP 不实现第二套 Runtime，所有 Tool 调用统一进入 `ActionRunner`，完全享有输入/输出校验、SQLite 执行记录与循环调用防御。
2. **Schema 零重复定义**：直接基于 `@modelcontextprotocol/server` 的 `fromJsonSchema`，无缝复用 Action 已定义的 JSON Schema。
3. **完整取消链路**：客户端发送的 `notifications/cancelled` 自动接入 `ctx.signal`，实现全链路响应式中断。
4. **统一安全模型**：HTTP 模式下复用 Bearer Token、Loopback 绑定安全默认值与 CORS 白名单策略。

---

## 1. STDIO 模式（本地 Agent / 桌面 IDE 直连）

STDIO 模式是桌面端 AI 编程助手的首选模式。`ac mcp` 保证 `stdout` 仅输出协议消息，所有日志均写入 `stderr`。

### 启动命令
```bash
# 启动当前项目所在 package
ac mcp

# 指定项目目录或 package ID
ac mcp --dir /path/to/my-tools
ac mcp --package team4u.github-tools

# 配置执行超时（默认无超时限制）
ac mcp --timeout 30s
```

### MCP 客户端接入配置

#### Claude Code (`~/.claude/mcp.json` 或项目 `.claude/mcp.json`)
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "bunx",
      "args": ["@actiondock/cli", "mcp", "--dir", "/absolute/path/to/my-tools"]
    }
  }
}
```

#### Cursor (`settings.json` 或 Cursor Settings > MCP)
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "ac",
      "args": ["mcp", "--dir", "/absolute/path/to/my-tools"]
    }
  }
}
```

#### VS Code (Claude / Copilot MCP 插件配置)
```json
{
  "mcpServers": {
    "my-tools": {
      "command": "ac",
      "args": ["mcp", "--dir", "${workspaceFolder}"]
    }
  }
}
```

---

## 2. HTTP 模式（远程微服务 / Streamable HTTP）

HTTP 模式将 ActionDock MCP 作为独立微服务部署，提供标准 `/mcp` 端点与 `/health` 健康检查接口。

### 启动命令
```bash
# 本地开发测试（默认监听 127.0.0.1:5178）
ac mcp serve --port 5178

# 生产环境暴露（强制要求 Token 鉴权）
export ACTIONDOCK_MCP_TOKEN="super-secret-token"
ac mcp serve \
  --host 0.0.0.0 \
  --port 5178 \
  --token-env ACTIONDOCK_MCP_TOKEN \
  --cors-origin "https://chat.example.com" \
  --max-body 2mb
```

### HTTP 安全选项
* `-H, --host <host>`：绑定地址。非 Loopback 地址（如 `0.0.0.0`）必须配置 Token，否则拒绝启动。
* `-t, --token <token>`：Bearer 鉴权 Token。
* `--token-env <env>`：推荐方式，通过环境变量名指定 Token，避免命令行明文记录。
* `--allow-insecure-no-auth`：显式允许非本地无 Token 暴露（仅限隔离内网）。
* `--cors-origin <origin>`：配置允许跨域调用的 Origin。

---

## 3. Tool 映射与数据格式

### 映射关系
| ActionDock 概念 | MCP 概念 | 映射规则 |
| :--- | :--- | :--- |
| `action.id` | `tool.name` | 保持严格一致（如 `github.list-prs`） |
| `action.description` | `tool.description` | 直接透传 |
| `action.inputSchema` | `tool.inputSchema` | `fromJsonSchema(inputSchema)` |
| `action.outputSchema`| `tool.outputSchema` | `fromJsonSchema(outputSchema)` |
| `runner.execute()` | `tool.handler` | 内部调用 `ActionRunner.execute()` |

### 响应格式规范

#### 成功调用 (`result.ok: true`)
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":true,\"runId\":\"01J...\",\"data\":{\"total\":5}}"
    }
  ],
  "structuredContent": {
    "total": 5
  }
}
```
* `content` 中保留 ActionDock 标准 JSON Envelope（包含全局可溯源的 `runId`）。
* `structuredContent` 提供纯净 Action 输出，符合 `outputSchema` 契约。

#### 业务与校验失败 (`result.ok: false`)
```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":false,\"runId\":\"01J...\",\"error\":{\"code\":\"INPUT_VALIDATION_FAILED\",\"message\":\"...\"}}"
    }
  ]
}
```
* 业务异常、参数校验不通过等均映射为 `isError: true`，避免抛出协议层 JSON-RPC 异常而破坏 MCP 会话。

---

## 4. 取消传播机制 (Cancellation)

当 MCP 客户端发送取消通知时：
```text
MCP Client (notifications/cancelled)
                │
                ▼
     ctx.mcpReq.signal (MCP SDK)
                │
                ▼
           ActionRunner
                │
                ▼
        ActionContext.signal
                │
                ▼
     Action (fetch abort / throw)
```
ActionDock 会自动将 SQLite 中的 `runs` 状态置为 `cancelled`，错误码记为 `ACTION_CANCELLED`。

---

---

## 5. MCP Tasks 长任务扩展 (`io.modelcontextprotocol/tasks`)

ActionDock MCP 适配器实现了官方 MCP Tasks 扩展，支持异步长任务执行、状态查询与任务中断：

### 1. 契约映射原则
* **任务 ID**：`MCP taskId` 完全等价于 ActionDock 系统的 `runId`。
* **状态映射**：
  * `running` $\rightarrow$ `working`
  * `success` $\rightarrow$ `completed`
  * `failed` $\rightarrow$ `failed`
  * `cancelled` $\rightarrow$ `cancelled`
* **持久化**：统一存取自 SQLite `runs` 表，无需维护第二套 Task 存储。

### 2. 异步 Tool 调用
在调用 `tools/call` 时传入 `execution: { mode: "async" }`，MCP Server 将立即返回 `taskId` 与 `status: "running"`，任务在后台继续执行：
```json
{
  "ok": true,
  "runId": "01J...",
  "taskId": "01J...",
  "status": "running"
}
```

### 3. Tasks 协议端点
* **`tasks/get`**：查询指定 Task 的执行状态、输入、输出或错误详情。
  ```json
  { "method": "tasks/get", "params": { "taskId": "01J..." } }
  ```
* **`tasks/cancel`**：主动中断正在执行中的长任务（信号直通 `ctx.signal`）。
  ```json
  { "method": "tasks/cancel", "params": { "taskId": "01J...", "reason": "User cancelled" } }
  ```
* **`tasks/list`**：列出当前包的近期 Task 执行记录。
  ```json
  { "method": "tasks/list", "params": { "limit": 20 } }
  ```

---

## 6. 调试与排错

### 使用 MCP Inspector 调试
可以使用官方 MCP Inspector 本地测试 MCP Tool 注册、调用与 Tasks 扩展：

```bash
npx @modelcontextprotocol/inspector ac mcp --dir ./examples/github-tools
```

