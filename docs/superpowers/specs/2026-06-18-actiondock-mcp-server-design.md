# ActionDock MCP Server 设计 Spec

> 来源：用户设计文档（note.fjay.top `20260618-120056-176`）+ 真实代码核对 + MCP SDK 1.29.0 源码核对。
> 本 spec 已修正原设计文档中与真实代码不符之处（见文末「设计修正记录」）。

## 1. 目标

为 `actiondock-cli` 增加 MCP Server，使 ChatGPT、Cursor、Claude、Cline 等 MCP 客户端能通过标准 MCP 协议调用 ActionDock 能力。

**核心原则**：MCP 只做协议适配层，所有能力复用现有 `ActionDockClient` 分域 API，不重写业务逻辑。

支持两种启动方式：

```bash
actiondock mcp --transport stdio
actiondock mcp --transport http --host 127.0.0.1 --port 5178 --endpoint /mcp
```

## 2. 架构

```text
ChatGPT / Cursor / Claude / Cline
        │  MCP (stdio / Streamable HTTP)
        ▼
  actiondock mcp   (Oclif 命令)
        │  复用 ActionDockClient 分域 API
        ▼
ActionDock REST API (http://127.0.0.1:5177/api)
        ▼
ActionDock Runtime
```

MCP 层位于 CLI 进程内，所有 tool handler 调用 `this.getClient(flags)` 拿到的 `ActionDockClient`，HTTP 请求走现有 Node 原生 `http` transport + envelope 自动解包。

## 3. 落地位置

全部新增代码放在 `actiondock-cli/src/` 下：

```text
actiondock-cli/src/
  commands/
    mcp.ts                      # Oclif 命令入口

  mcp/
    index.ts                    # startActionDockMcp() 对外入口
    server.ts                   # createActionDockMcpServer() + 注册所有静态/动态 tools
    types.ts                    # McpPolicy / ToolRisk / 内部类型

    core/
      register-tool.ts          # registerActionDockTool() 统一封装（权限+脱敏+限流+错误）
      policy.ts                 # requireRisk()
      result.ts                 # toMcpJson() / toMcpError() / 结果大小限制
      redaction.ts              # redactSecrets()
      names.ts                  # toToolSafeName() / splitCsv()
      schema.ts                 # jsonSchemaToZod()

    transports/
      stdio.ts                  # StdioServerTransport
      http.ts                   # Node 原生 http + StreamableHTTPServerTransport(stateless)

    tools/
      health.ts
      scripts.ts                # list/get/schema/run
      dynamic-scripts.ts        # 动态注册已发布脚本为 tool
      plugins.ts                # list/get/invoke
      repositories.ts           # list/resolve/script list+get/knowledge list+get
      webhooks.ts               # list/get/invoke
      executions.ts             # list/get
      playbooks.ts              # list/get
```

单测与源码同目录：`mcp/core/schema.test.ts` 等（遵循现有 CLI 测试约定 `test/` 目录）。

## 4. 依赖

在 `actiondock-cli/package.json` 的 `dependencies` 增加：

```json
{
  "@modelcontextprotocol/sdk": "^1.29.0",
  "zod": "^3.25.0"
}
```

**不加 express / cors** —— HTTP transport 直接用 Node 原生 `http` + `StreamableHTTPServerTransport`（stateless 模式），SDK 自带，零额外依赖。原设计「可加 express」在本期不需要。

理由：stateless Streamable HTTP 不依赖 express，SDK 示例 `simpleStatelessStreamableHttp.ts` 用 `createMcpExpressApp` 仅是便利封装；我们用原生 `http.createServer` + `transport.handleRequest(req, res, body)` 即可，体积更小、依赖更少，符合 CLI 包的轻量定位。

## 5. CLI 命令设计

```bash
actiondock mcp \
  --transport stdio \
  --server http://127.0.0.1:5177 \
  --token "$ACTIONDOCK_TOKEN"
```

### Flags

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--transport` | `stdio` | `stdio` 或 `http` |
| `--host` | `127.0.0.1` | HTTP 绑定地址（不允许默认 0.0.0.0） |
| `--port` | `5178` | HTTP 端口 |
| `--endpoint` | `/mcp` | MCP HTTP endpoint 路径 |
| `--enable-execute-tools` | `true` | 是否允许执行脚本/插件/Webhook |
| `--enable-write-tools` | `false` | 是否允许写操作（一期不开放） |
| `--enable-admin-tools` | `false` | 是否允许高风险管理操作（一期不开放） |
| `--enable-dynamic-tools` | `true` | 是否动态注册脚本 tools |
| `--allowed-scripts` | 空 | 脚本白名单，逗号分隔 |
| `--denied-scripts` | 空 | 脚本黑名单，逗号分隔 |
| `--max-result-bytes` | `200000` | 单 tool 返回结果字节上限 |
| `--redact-secrets` | `true` | 是否脱敏敏感字段 |

复用现有连接参数：`--server` / `--token` / `--profile` / `--json`（来自 `BaseCommand`）。

环境变量（与 flag 同名、CLI 既有约定优先级）：`ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN` / `ACTIONDOCK_PROFILE`，外加 MCP 专属：`ACTIONDOCK_MCP_ENABLE_*` / `ACTIONDOCK_MCP_ALLOWED_SCRIPTS` / `ACTIONDOCK_MCP_DENIED_SCRIPTS` / `ACTIONDOCK_MCP_MAX_RESULT_BYTES` / `ACTIONDOCK_MCP_REDACT_SECRETS`。

### 命令实现要点

- 必须 `extends BaseCommand`，复用 `baseFlags` / `connectionFlags` / `getClient()` / `handleError()`。
- flags 用 `Flags.boolean()` / `Flags.string()` / `Flags.integer()`；transport 用 `options: ["stdio","http"]`。
- `run()` 内 `this.getClient(flags)` 拿 client，组装 `McpPolicy`，调用 `startActionDockMcp({ client, ...options, policy })`。
- MCP server 是长驻进程，不调用 `printJson`；日志打到 stderr（stdio 模式下 stdout 被 MCP 占用）。

## 6. Client 调用规范（已逐项核对真实代码）

必须用分域 API。**关键：健康检查方法是 `client.health.health()`，不是 `check()`**。

```ts
client.health.health()                                              // → HealthView { ok, server, status?, details? }

client.scripts.list()                                               // → ScriptDefinition[]
client.scripts.get(scriptId, draft)                                 // → ScriptDefinition
client.scripts.execute({ scriptId, input, mode, responseView }, draft)  // → ExecutionResponse

client.plugins.list()                                               // → PluginSummaryView[]
client.plugins.get(pluginId)                                        // → PluginView
client.plugins.invoke(pluginId, action, payload)                    // payload: PluginInvokeRequest {args, scriptInput, responseView?, configName?}

client.repositories.list()                                          // → RepositoryDefinition[]
client.repositories.resolveProject(repositoryId)                    // → ProjectRepositoryResolution（content 字段即 ACTIONDOCK.md 全文）
client.repositories.listScripts(repositoryId?)                      // → RepositoryScriptDescriptor[]
client.repositories.getScript(repositoryId, scriptId)               // → RepositoryScriptDetail
client.repositories.listKnowledge(repositoryId?)                    // → RepositoryKnowledgeDescriptor[]
client.repositories.getKnowledge(repositoryId, knowledgeId)         // → RepositoryKnowledgeDetail

client.webhooks.list()                                              // → WebhookDefinition[]
client.webhooks.get(webhookId)                                      // → WebhookDefinition
client.webhooks.invoke(webhookId, payload)                          // → WebhookInvokeResult {status, headers, body?}

client.executions.list({ scriptId?, scheduleId? })                  // → ExecutionResponse[]
client.executions.get(executionId)                                  // → ExecutionResponse

client.playbooks.list({ repositoryId?, tag?, enabled?, managed? })  // → Playbook[]
client.playbooks.get(playbookId)                                    // → Playbook
```

`mode` 取值 `"SYNC" | "ASYNC"`；`responseView` 取值 `"RESULT" | "DEBUG"`。execute 第二个参数 `draft: boolean` 控制执行草稿还是发布版本。

## 7. MCP Tool 分级

```ts
type ToolRisk = "read" | "execute" | "write" | "admin";

interface McpPolicy {
  enableExecuteTools: boolean;
  enableWriteTools: boolean;
  enableAdminTools: boolean;
  enableDynamicTools: boolean;
  allowedScripts: string[];
  deniedScripts: string[];
  maxResultBytes: number;
  redactSecrets: boolean;
}
```

默认策略：`read` 永远开；`execute` 默认开；`write` / `admin` 默认关（一期不开放）。

```ts
function requireRisk(risk: ToolRisk, policy: McpPolicy): void {
  if (risk === "read") return;
  if (risk === "execute" && policy.enableExecuteTools) return;
  if (risk === "write" && policy.enableWriteTools) return;
  if (risk === "admin" && policy.enableAdminTools) return;
  throw new Error(`Tool disabled by MCP policy: ${risk}`);
}
```

## 8. 一期 Tool 清单

### 健康检查
- `actiondock_health`（read）

### 脚本
- `actiondock_script_list`（read）
- `actiondock_script_get`（read）— 入参 `{scriptId, draft?}`
- `actiondock_script_schema`（read）— 入参 `{scriptId, draft?}`，返回人类可读字段说明（基于 `extractSchemaFields`）
- `actiondock_script_run`（execute）— 入参 `{scriptId, input, draft?, mode?, responseView?}`，调用 `client.scripts.execute`

### 动态脚本
- `actiondock_script__<normalized_id>`（execute）— 已发布脚本动态注册

### 插件
- `actiondock_plugin_list`（read）
- `actiondock_plugin_get`（read）— `{pluginId}`
- `actiondock_plugin_invoke`（execute）— `{pluginId, action, args?, scriptInput?, responseView?, configName?}`

### 仓库 / 项目知识
- `actiondock_repository_list`（read）
- `actiondock_repository_resolve`（read）— `{repositoryId}`，返回 ACTIONDOCK.md 内容
- `actiondock_repository_script_list`（read）— `{repositoryId?}`
- `actiondock_repository_script_get`（read）— `{repositoryId, scriptId}`
- `actiondock_repository_knowledge_list`（read）— `{repositoryId?}`
- `actiondock_repository_knowledge_get`（read）— `{repositoryId, knowledgeId}`

### Webhook
- `actiondock_webhook_list`（read）
- `actiondock_webhook_get`（read）— `{webhookId}`
- `actiondock_webhook_invoke`（execute）— `{webhookId, payload}`，返回 `{status, headers, body}`

### 执行记录
- `actiondock_execution_list`（read）— `{scriptId?, scheduleId?}`
- `actiondock_execution_get`（read）— `{executionId}`

### Playbook
- `actiondock_playbook_list`（read）— `{repositoryId?, tag?, enabled?, managed?}`
- `actiondock_playbook_get`（read）— `{playbookId}`

**一期不暴露**（二期经 `--enable-write-tools` / `--enable-admin-tools` 开放）：access-token、plugin install/upgrade/uninstall、repository/script delete、execution clear、config-value write/delete、shared-state write/delete。

## 9. 动态脚本 Tool 设计

ActionDock 脚本有 `inputSchema`（JSON Schema）。一期只注册**已发布**脚本：

```ts
const isPublished = (s: ScriptDefinition) =>
  Boolean(s.publication?.published) || s.published != null;
```

经 `normalizeScriptDefinition` 后 `publication.published` 可靠。

### 白名单 / 黑名单

`--allowed-scripts` 非空时只注册命中项；`--denied-scripts` 命中项跳过。匹配原始 `script.id`。

### 工具名

`actiondock_script__<normalized_script_id>`，归一化：

```ts
function toToolSafeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}
```

### 输入 schema（JSON Schema → Zod）

由于 MCP SDK 的 `registerTool` **只接受 Zod schema**（内部 `getZodSchemaObject()` 会校验 `_def`/`_zod` 标记，原生 JSON Schema 会被拒），必须转换。转换规则：

```ts
function jsonSchemaToZod(schema: JsonSchema): ZodSchema
```

| JSON Schema | Zod |
|---|---|
| `string` (+ `enum` → `z.enum`) | `z.string()` / `z.enum([...])` |
| `number` | `z.number()` |
| `integer` | `z.number().int()` |
| `boolean` | `z.boolean()` |
| `array` (`items`) | `z.array(jsonSchemaToZod(items))` |
| `object` (`properties`/`required`) | `z.object({...})`，required 字段必填，其余 `.optional()` |
| 未识别 / `oneOf`/`anyOf`/`$ref` 等 | fallback `z.unknown()`（顶层 fallback `z.record(z.unknown())`） |

转换失败的脚本：input schema 降级为 `{ input: z.record(z.unknown()) }`，但 tool 仍注册（保证可调用，只是不做字段校验）。

### 执行逻辑

```ts
await client.scripts.execute(
  { scriptId: script.id, input, mode: "SYNC", responseView: "RESULT" },
  false   // 动态 tool 只执行已发布版本
);
```

固定 `SYNC` + `RESULT`，避免客户端误传 `DEBUG` 泄露调试信息。

## 10. 统一 Tool 注册封装

```ts
registerActionDockTool(server, {
  name, description, risk, inputSchema,   // inputSchema: Zod raw shape
  policy, handler                          // handler: (args, client) => Promise<unknown>
});
```

内部流程：

1. `requireRisk(risk, policy)` — 不满足则注册即跳过（tool 不出现在 list）
2. try/catch 调用 `handler(args, client)`
3. `redactSecrets(data)` 脱敏（若 `policy.redactSecrets`）
4. 结果大小限制（`policy.maxResultBytes`），超限截断并标注 `truncated`
5. `toMcpJson()` 转 `{content: [{type:"text", text: JSON.stringify(...)}]}`
6. 异常 → `toMcpError()` 返回 `{content:[{type:"text", text}], isError: true}`

封装使每个 tool 文件只关心「调用哪个 client 方法」，不重复权限/脱敏/错误样板。

## 11. 返回结构

统一成功：

```json
{ "ok": true, "data": {} }
```

超限：

```json
{ "ok": true, "truncated": true, "sizeBytes": 381204, "data": { "preview": "..." } }
```

统一失败：

```json
{ "ok": false, "error": { "code": "ACTIONDOCK_ERROR", "message": "...", "detail": {} } }
```

MCP content 统一：

```ts
{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
```

## 12. 脱敏规则

返回客户端前，命中以下字段名（大小写不敏感、子串匹配）时替换为 `***`：

```
token tokenValue accessToken refreshToken authorization password secret apiKey privateKey credential
```

递归遍历对象/数组。`--redact-secrets false` 可关闭。

## 13. 结果大小限制

默认 `ACTIONDOCK_MCP_MAX_RESULT_BYTES=200000`。序列化后超过则截断：保留前 `maxResultBytes` 字节，附加 `truncated: true` 和原 `sizeBytes`，`data` 内放截断预览。

## 14. HTTP Transport 安全

- 默认只监听 `127.0.0.1`，绝不默认 `0.0.0.0`。
- stateless 模式：每个请求新建 `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`，`server.connect(transport)` 后 `transport.handleRequest(req, res, body)`，`res.on('close')` 时 `transport.close()`。
- 请求体大小限制（默认 10MB，防大 payload）。
- 仅处理 POST `${endpoint}`；GET/DELETE 返回 405 JSON-RPC 错误。
- 生产接入（ChatGPT Web 等）：用户自行用 `ngrok http 5178` 或反代上 HTTPS + Bearer，本期不内置 OAuth。

## 15. 启动流程

```text
1. actiondock mcp 启动 → BaseCommand 解析 flags
2. getClient(flags) 创建 ActionDockClient
3. createActionDockMcpServer(client, policy)
4. 注册静态 tools（policy gating 自动跳过被禁用的）
5. 若 enableDynamicTools：client.scripts.list() → 过滤已发布 + 黑白名单 → 注册动态 tools
6. 根据 transport 启动 stdio 或 http（打印启动信息到 stderr）
7. 注册 SIGINT/SIGTERM 优雅关闭
```

## 16. 测试计划

### 单元测试（vitest，`test/mcp/`）

- `toToolSafeName()` — 含特殊字符、空、连续分隔符
- `jsonSchemaToZod()` — 各类型 + 嵌套 + 枚举 + 必填/可选 + fallback
- `requireRisk()` — 各级别开关组合
- `redactSecrets()` — 命中字段、嵌套、数组、关闭开关
- 结果大小限制 — 不超 / 超限截断
- `toMcpJson()` / `toMcpError()` — 输出结构正确
- `splitCsv()` — 空、单、多、含空白

### 集成验证（遵循 AGENTS.md 前端编译要求）

```bash
cd actiondock-cli && npx tsc --noEmit && npm run build && npm test
```

MCP Inspector 冒烟（手动，文档说明）：

```bash
npx @modelcontextprotocol/inspector actiondock mcp --transport stdio
```

## 17. 验收标准（设计 §22，10 条）

1. `actiondock mcp --transport stdio` 可启动
2. `actiondock mcp --transport http` 可启动
3. MCP Inspector 可列出 tools
4. 能通过 MCP 执行 ActionDock 脚本
5. 已发布脚本能自动注册为动态 tools
6. 能调用插件 action
7. 能读取 repository resolve 的项目上下文（ACTIONDOCK.md）
8. 默认不暴露 write/admin 风险工具
9. 返回结果中敏感字段被脱敏
10. （ChatGPT Web 经 ngrok 接入为手动验证，文档覆盖）

## 设计修正记录（相对原设计文档）

| # | 原设计 | 修正后 | 原因 |
|---|---|---|---|
| 1 | `client.health.check()` | `client.health.health()` | 真实 `HealthApi` 只有一个方法 `health()`，无 `check()` |
| 2 | 可选加 `express`+`cors` 做路由 | **不加**，用 Node 原生 `http` + SDK `StreamableHTTPServerTransport` | stateless HTTP 不依赖 express，SDK 自带；减少 CLI 包体积 |
| 3 | 动态脚本 `inputSchema` 直接透传 JSON Schema | **JSON Schema → Zod 转换** | SDK `registerTool` 强制要求 Zod（校验 `_def`/`_zod`），原生 JSON Schema 会被拒。这正是原设计 §12 写转换的本意 |
| 4 | SDK `^1.0.0` | `^1.29.0` | 1.0.0 太旧，`StreamableHTTPServerTransport`/`registerTool` 等需 1.x 较新版本；当前最新稳定 1.29.0 |
| 5 | 动态 tool `responseView` 由调用方决定 | 固定 `SYNC` + `RESULT` | 避免客户端误传 `DEBUG` 泄露调试信息 |
| 6 | repository tools 未列 knowledge/script 子集 | 明确列出 script_list/script_get/knowledge_list/knowledge_get | 真实 `RepositoryApi` 已有这些方法，设计 §9 已暗示，补齐 |
| 7 | — | 新增 `--max-result-bytes` / `--redact-secrets` flag | 设计 §13/§16 提到限制和脱敏，但 §5 flags 表未列；补齐 CLI 入口 |
