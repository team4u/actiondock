# MCP 集成（接入 ChatGPT / Cursor / Claude 等）

## 一句话理解

ActionDock CLI 内置 MCP Server。运行 `actiondock mcp` 即可让 ChatGPT、Cursor、Claude、Cline 等 MCP 客户端通过标准 MCP 协议调用你的 ActionDock 能力（脚本、插件、仓库知识、Webhook 等），无需为每个客户端单独写集成。

## 它是什么

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 是让 LLM 客户端统一接入外部工具/数据的开放协议。ActionDock 把自身的脚本执行、插件调用、项目知识读取等能力封装成一组 MCP Tool，任何 MCP 客户端都能直接调用——等价于「让 AI 自动学会用你的 `actiondock` CLI」。

```text
ChatGPT / Cursor / Claude / Cline
        │  MCP（stdio 或 HTTP）
        ▼
  actiondock mcp            ← CLI 内置的 MCP Server（本页讲的就是它）
        │  复用 ActionDockClient
        ▼
ActionDock REST API（http://127.0.0.1:5177/api）
        ▼
ActionDock Runtime（脚本 / 插件 / 仓库 / Webhook）
```

## 前置条件

1. **ActionDock 服务已运行**（默认 `http://127.0.0.1:5177`）。先验证：

   ```bash
   actiondock health --json
   ```

2. **CLI 能连接该服务**。若服务启用了访问令牌认证，先用 profile 配置好：

   ```bash
   actiondock config add local --server http://127.0.0.1:5177 --token "$ACTIONDOCK_TOKEN"
   actiondock config use local
   ```

3. **动态脚本工具**只会注册**已发布**的脚本。要被 AI 当作独立工具调用，先把脚本发布：

   ```bash
   actiondock script publish my-script
   ```

## 启动 MCP Server

`actiondock mcp` 支持两种 transport，按你的客户端类型选择。

### 方式一：stdio（本地客户端，推荐）

适合 Cursor、Claude Desktop、Cline、VS Code 插件等**与 CLI 在同一台机器**、通过子进程 stdio 通信的客户端。这是最简单、最安全的接入方式。

```bash
actiondock mcp --transport stdio
```

客户端配置里直接把启动命令指向它（见下方各客户端示例）。

### 方式二：HTTP（远程 / Web 客户端）

适合 ChatGPT Web、或需要跨机器访问的场景。HTTP 模式默认**只监听本机回环地址**（`127.0.0.1`），不暴露到公网。

```bash
actiondock mcp --transport http --host 127.0.0.1 --port 5178 --endpoint /mcp
```

启动后接入点为：

```text
http://127.0.0.1:5178/mcp
```

> **跨机器 / 公网接入**：先用隧道或反向代理把本地的 `5178` 暴露出去，并在代理层加 HTTPS + 鉴权。例如本地开发联调：
>
> ```bash
> ngrok http 5178
> # 得到 https://xxxxx.ngrok.app，在客户端填 https://xxxxx.ngrok.app/mcp
> ```
>
> 生产环境建议走 `HTTPS 反向代理 + Bearer Token → 127.0.0.1:5178/mcp`，不要直接对外裸跑。

### 鉴权：身份透传，MCP 不持有凭证

HTTP 模式下 **MCP 进程本身不持有任何 token**，也不做独立的鉴权。它把鉴权完全交给 ActionDock 后端：

- 客户端在请求里带 `Authorization: Bearer <访问令牌>`，MCP 会把这个 token **原样透传**给 ActionDock 后端去校验；
- 后端校验通过 → 正常返回；token 缺失 / 失效 / 禁用 → 后端返回 `401`，MCP 把它转成工具错误回给客户端；
- 客户端**没带** `Authorization` 时，MCP 也**不会**凭空补一个，而是以匿名身份请求后端——后端若启用了访问令牌认证就会拒绝，没启用就放行。

也就是说，谁有什么权限，完全由后端的访问令牌决定；MCP 只是一层协议网关。`--token` / `ACTIONDOCK_TOKEN` 在 HTTP 模式下**不生效**（那是 stdio 模式下子进程的身份）。要在 HTTP 模式下传身份，请在客户端请求头里带 `Authorization`。

> ⚠️ 注意：并非所有客户端都能自己带 `Authorization`。比如 **ChatGPT Web 的自定义连接器就只能选「OAuth」或「无认证」，发不出 Bearer 令牌**——这种场景需要在反向代理层注入令牌，详见下方 [ChatGPT Web 章节](#chatgpt-web远程-http) 的「鉴权怎么配」。

## 各客户端配置示例

### Cursor

编辑 `~/.cursor/mcp.json`（或项目级 `.cursor/mcp.json`），新增一个 server：

```json
{
  "mcpServers": {
    "actiondock": {
      "command": "actiondock",
      "args": ["mcp", "--transport", "stdio"],
      "env": {
        "ACTIONDOCK_BASE_URL": "http://127.0.0.1:5177",
        "ACTIONDOCK_TOKEN": "你的访问令牌（若启用了认证）"
      }
    }
  }
}
```

保存后在 Cursor 设置 → MCP 中确认 `actiondock` 状态为绿色。

### Claude Desktop

编辑 Claude Desktop 配置文件（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows: `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "actiondock": {
      "command": "actiondock",
      "args": ["mcp", "--transport", "stdio"]
    }
  }
}
```

若 CLI 未全局安装，`command` 改为 `actiondock` 的绝对路径（`which actiondock` 查看）。改完重启 Claude Desktop。

### Cline / VS Code 类插件

大多数基于子进程 stdio 的客户端，配置项同 Cursor：`command` = `actiondock`，`args` = `["mcp", "--transport", "stdio"]`，需要时在 `env` 里传 `ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN`。

### ChatGPT Web（远程 HTTP）

启动 HTTP transport 后，通过隧道获得公网 URL，在 ChatGPT 的「Connectors / 自定义连接器」里填：

```text
https://<你的公网域名>/mcp
```

#### 鉴权怎么配

**先说结论：ChatGPT 的自定义连接器不支持填自定义 `Authorization: Bearer <令牌>`，只支持「OAuth」或「无认证」。** 所以鉴权要按后端是否启用了访问令牌分两种情况：

**情况一：后端没启用访问令牌认证（默认）**

最简单。ActionDock 默认不强制鉴权（系统里没有任何启用的令牌时，所有 `/api/*` 请求直接放行）。ChatGPT 连接器选「无认证」直连即可，MCP 的身份透传此时也不会给请求补任何 header，链路完全透明。

**情况二：后端启用了访问令牌认证**

由于 ChatGPT 自己发不出 Bearer 令牌，需要在**反向代理层注入**令牌再转发给 MCP：

```text
ChatGPT（无认证 / OAuth）
      │  https
      ▼
你的反向代理（nginx / Caddy / Cloudflare Worker）
  └─ 注入 Authorization: Bearer <你的访问令牌>
      │  http
      ▼
actiondock mcp --transport http（127.0.0.1:5178/mcp）
      │  透传令牌
      ▼
ActionDock 后端（校验令牌）
```

nginx 示例（强制覆盖请求头里的令牌）：

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:5178/mcp;
    proxy_set_header Authorization "Bearer adk_你的访问令牌";
    proxy_buffering off;          # MCP 用 SSE 流式响应，必须关缓冲
    proxy_read_timeout 600s;
}
```

> 代理注入的是「给 ChatGPT 用的固定令牌」，相当于把 ChatGPT 当成一个具名客户端。若要给不同 ChatGPT 账号不同权限，需各自用独立令牌 + 各自代理路径。MCP 侧不区分客户端，身份完全由代理注入的令牌决定。

> 若你希望走标准 OAuth（例如对接 Auth0），需要在 MCP 前再架一层 OAuth 网关把 ChatGPT 的 OAuth 流程接上，超出本文范围。


### 通用：MCP Inspector 调试

不确定客户端为什么连不上时，先用官方 Inspector 隔离验证：

```bash
# stdio
npx @modelcontextprotocol/inspector actiondock mcp --transport stdio

# http（先另起一个终端跑 actiondock mcp --transport http --port 5178）
npx @modelcontextprotocol/inspector
# 在打开的 Inspector 页面里填 http://127.0.0.1:5178/mcp
```

Inspector 能列出全部工具、手动调用、查看请求响应，是最快的排错工具。

## 可用工具清单

启动后，客户端通过 `tools/list` 能看到以下工具（**默认只开启只读 + 执行**，写操作和管理操作默认关闭）：

| 分类 | 工具 | 说明 |
|---|---|---|
| 健康 | `actiondock_health` | 服务健康检查 |
| 脚本 | `actiondock_script_list` | 列出脚本 |
| | `actiondock_script_get` | 查看脚本详情 |
| | `actiondock_script_schema` | 查看脚本输入字段说明 |
| | `actiondock_script_run` | 执行脚本（默认 SYNC + RESULT） |
| | `actiondock_script__<脚本id>` | **已发布脚本自动注册的专用工具**（每个脚本一个） |
| 插件 | `actiondock_plugin_list` / `get` / `invoke` | 列出 / 查看 / 调用插件 Action |
| 仓库 | `actiondock_repository_list` | 列出仓库 |
| | `actiondock_repository_resolve` | 解析项目仓库，返回 `ACTIONDOCK.md` 全文（给 AI 项目上下文） |
| | `actiondock_repository_script_list` / `get` | 仓库脚本目录 |
| | `actiondock_repository_knowledge_list` / `get` | 仓库知识源 |
| Webhook | `actiondock_webhook_list` / `get` / `invoke` | 列出 / 查看 / 触发 Webhook |
| 执行记录 | `actiondock_execution_list` / `get` | 查看历史执行 |
| 任务手册 | `actiondock_playbook_list` / `get` | 列出 / 查看任务手册 |

**动态脚本工具**命名规则：`actiondock_script__` + 脚本 id 归一化（小写、非字母数字下划线转为 `_`）。例如脚本 `hello-groovy` → `actiondock_script__hello_groovy`。脚本的 `inputSchema` 会自动转换为工具的输入参数，AI 可以直接按字段填参调用。

## 安全策略与权限开关

MCP 默认走**最小权限**：只读查询和脚本执行默认开启；创建/修改/发布、删除、令牌管理、插件安装等高风险操作默认**不暴露**。

通过命令行 flag 或环境变量调整：

| Flag | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `--enable-execute-tools` | `ACTIONDOCK_MCP_ENABLE_EXECUTE_TOOLS` | `true` | 允许执行脚本/插件/Webhook |
| `--enable-write-tools` | `ACTIONDOCK_MCP_ENABLE_WRITE_TOOLS` | `false` | 允许写操作（一期暂未实现，预留） |
| `--enable-admin-tools` | `ACTIONDOCK_MCP_ENABLE_ADMIN_TOOLS` | `false` | 允许高风险管理操作（一期暂未实现，预留） |
| `--enable-dynamic-tools` | `ACTIONDOCK_MCP_ENABLE_DYNAMIC_TOOLS` | `true` | 动态注册已发布脚本为工具 |
| `--allowed-scripts` | `ACTIONDOCK_MCP_ALLOWED_SCRIPTS` | 空 | 脚本白名单（逗号分隔），非空时只注册命中的脚本 |
| `--denied-scripts` | `ACTIONDOCK_MCP_DENIED_SCRIPTS` | 空 | 脚本黑名单（逗号分隔），命中的脚本不注册 |
| `--max-result-bytes` | `ACTIONDOCK_MCP_MAX_RESULT_BYTES` | `200000` | 单次工具返回结果字节上限，超出截断 |
| `--redact-secrets` | `ACTIONDOCK_MCP_REDACT_SECRETS` | `true` | 返回结果中的 token/password/secret 等字段自动脱敏为 `***` |

示例：只让 AI 用两个脚本，并禁止其它：

```bash
actiondock mcp --transport stdio \
  --allowed-scripts "hello-groovy,email-send" \
  --denied-scripts "dangerous-script"
```

**敏感字段脱敏**：返回结果里字段名包含 `token` / `password` / `secret` / `apiKey` / `credential` 等（不区分大小写）时，值会被替换为 `***`，避免把密钥喂给模型。

连接参数（`--server` / `--token` / `--profile`）与其它 CLI 命令一致，详见 [CLI 参考](cli-reference.md)。

## 一个完整例子

让 AI 调用你的 `hello-groovy` 脚本：

1. 确认脚本已发布：

   ```bash
   actiondock script publish hello-groovy
   ```

2. 在客户端配置里接入 `actiondock mcp --transport stdio`（见上方各客户端示例）。

3. 在 AI 对话里直接说「用 ActionDock 跑一下 hello-groovy，名字填 MCP」。AI 会调用 `actiondock_script__hello_groovy`（或 `actiondock_script_run`），返回类似：

   ```json
   { "ok": true, "data": { "status": "SUCCESS", "output": { "message": "Hello, MCP!" } } }
   ```

## 常见问题

### Q: tools/list 里看不到动态脚本工具

- 确认脚本**已发布**（`actiondock script list --json` 看 `publication.published`）。
- 检查 `--allowed-scripts` / `--denied-scripts` 是否把它过滤掉了。
- 动态注册在 server 启动时读取脚本列表，新发布的脚本需**重启 `actiondock mcp`** 才会出现。

### Q: stdio 启动了但客户端连不上

- 必须通过客户端的 MCP 配置（`command` + `args`）拉起，而不是手动 `node dist/commands/mcp.js`——oclif 命令需经框架入口分发。全局安装的 `actiondock` 即是正确入口。
- 用 MCP Inspector 先验证（见上文），能连上说明问题在客户端配置。
- 检查 `ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN` 是否传到了子进程环境。

### Q: HTTP 模式如何对外安全暴露

不要直接 `--host 0.0.0.0`。用 ngrok（联调）或反向代理（生产）做 HTTPS，再转发到本地 `127.0.0.1:5178/mcp`。

鉴权本身不需要在代理层另做一层——HTTP 模式会把客户端请求里的 `Authorization: Bearer <令牌>` 透传给 ActionDock 后端校验。所以只要客户端带上了有效的访问令牌，后端会按令牌权限放行；代理层只需负责 HTTPS 和（可选的）访问控制即可。

### Q: AI 调用返回结果被截断了

工具返回超过 `--max-result-bytes`（默认 200KB）会被截断，返回里带 `"truncated": true`。如需更大可调高该值，但注意过大的上下文会消耗模型 token。

---

> [返回目录](user-manual.md)
