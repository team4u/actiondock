# HTTP 远程微服务与 API 调度

当需要将 ActionDock 部署为微服务，供远程 AI Agent、Webhook、持续集成流水线或前端业务系统远程调度时，可以使用 `ad serve` 启动轻量级 HTTP 调度微服务。

服务端原生基于 Bun 高性能 HTTP 引擎与 SQLite 内置驱动构建，具备极低的冷启动延迟与内存占用，全面对齐 CLI 的全套能力，包括能力自省、动作执行、剧本检索、任务流、状态管理、配置治理、深度体检以及一体化 Model Context Protocol 协议网关。

---

## 启动姿态

`ad serve` 具备高度灵活性，支持多种启动姿态：

- **全局路由模式（推荐，任意目录直接启动）**
  在系统的任意终端路径直接执行 `ad serve`。服务端自动启动为全局路由模式，动态感知并通过全局注册表聚合所有通过 `ad link` 注册的包与工作区：

```bash
# 生产或云端远程微服务启动（监听非回环地址 0.0.0.0，强制要求 Token 鉴权）
ad serve --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret"

# 本地单机调试（默认绑定 127.0.0.1 回环地址）
ad serve --port 5177 --token "sk-actiondock-secret"
```

- **单包项目模式（在包项目目录内）**
  在包含 `actiondock.json` 的项目目录内运行：

```bash
cd examples/github-tools
ad serve --host 0.0.0.0 --port 8080 --token "sk-actiondock-secret"
```

- **跨目录指定路径**
  无需切换目录，在任意路径通过 `-d, --dir` 参数指定目标包目录：

```bash
ad serve -d ./examples/github-tools --host 0.0.0.0 --port 8080 --token "sk-actiondock-secret"
```

- **独立单文件可执行文件运行（目标环境零依赖）**
  对于通过 `ad build` 编译生成的独立可执行文件，可在未安装 Bun 的生产服务器或容器中直接以微服务模式启动：

```bash
./dist/bin/github-tools serve --host 0.0.0.0 --port 8080 --token "sk-actiondock-secret"
```

---

## 网络监听与安全防御机制

- **非回环地址强制 Token 认证**：
  默认 `--host 127.0.0.1` 仅允许本机回环访问。当监听在非回环地址（如 `--host 0.0.0.0` 或服务器公网与局域网 IP）供远程调度时，执行引擎强制要求传入 `--token`（或通过环境变量 `ACTIONDOCK_TOKEN` 注入），未配置鉴权凭证将直接拒绝启动。
- **防时序攻击校验**：
  内置基于常数时间对比的 Token 校验，彻底阻断旁路分析。
- **请求体大小防护**：
  默认限制单个 JSON 请求体上限为 1MB（可通过 `--max-body 10mb` 调整），超限直接返回 413 状态码。
- **跨域资源共享策略**：
  默认关闭跨域，可通过 `--cors-origin <origin>` 显式添加白名单源。
- **敏感信息自动脱敏**：
  在配置查询接口中，被标记为密码、密钥等敏感字段的配置内容默认以星号掩码遮蔽，杜绝数据泄露。

---

## 标准 RESTful API 调度规范

所有接口均支持通过请求头 `Authorization: Bearer <token>` 或 URL 问号参数 `?token=<token>` 进行身份鉴权。

---

### 系统健康探查 (`GET /api/v1/health`)

用于容器健康探针与负载均衡存活检测：

```bash
curl http://localhost:5177/api/v1/health \
  -H "Authorization: Bearer sk-actiondock-secret"
```

响应数据：
```json
{
  "status": "ok",
  "version": "2.0.0",
  "timestamp": "2026-09-03T12:00:00.000Z",
  "uptime": 12.34
}
```

---

### 全局能力自省与意图探索 (`GET /api/v1/info`)

支持全局能力大纲、包层级下钻、模糊意图探索与拓扑树形查询。

- **获取全量能力大纲**：
```bash
curl http://localhost:5177/api/v1/info \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **意图探索与模糊检索** (`?intent=`)：
```bash
curl "http://localhost:5177/api/v1/info?intent=github" \
  -H "Authorization: Bearer sk-actiondock-secret"
```
当意图在全量包中唯一命中单项时，服务端自动决议并展开该包完整详情（包含动作清单、剧本清单与配置项定义）；命中多项时返回匹配列表；未命中时回退展示完整清单。

- **指定包详情深度下钻** (`?package=`)：
```bash
curl "http://localhost:5177/api/v1/info?package=team4u.github-tools" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **注册表工作区层级拓扑树** (`?tree=true`)：
```bash
curl "http://localhost:5177/api/v1/info?tree=true" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### 动作列表与详情查询 (`GET /api/v1/actions`)

- **检索动作列表**：
```bash
curl "http://localhost:5177/api/v1/actions?intent=pull-request" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **获取单项动作详情与参数契约**：
```bash
curl http://localhost:5177/api/v1/actions/github.get-pr \
  -H "Authorization: Bearer sk-actiondock-secret"
```
响应中包含完整的输入校验 Schema 与输出结构定义。

---

### 动作执行调度 (`POST /api/v1/actions/:id/run`)

- **同步阻塞执行**：
向目标动作投递参数，服务端同步阻塞执行完毕后返回标准 JSON Envelope：

```bash
curl -X POST http://localhost:5177/api/v1/actions/github.get-pr/run \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "repo": "team4u/actiondock",
      "prNumber": 101
    }
  }'
```
响应数据：
```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "id": 101,
    "title": "feat(core): support bun native compilation",
    "state": "open"
  }
}
```

- **异步非阻塞调度** (`"mode": "async"` 或 `"async": true`)：
对于批处理、耗时扫描或网络大任务，可开启异步模式：

```bash
curl -X POST http://localhost:5177/api/v1/actions/github.sync-all/run \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "repo": "team4u/actiondock" },
    "execution": {
      "mode": "async",
      "timeoutMs": 60000
    }
  }'
```
服务端立即响应 `202 Accepted` 并给出状态流地址：
```json
{
  "ok": true,
  "runId": "01JMB999ABCD...",
  "status": "running",
  "streamUrl": "/api/v1/runs/01JMB999ABCD.../stream"
}
```

---

### 任务运行历史与流式事件推送

- **运行记录多维检索** (`GET /api/v1/runs`)：
支持按动作标识、状态（`success`、`error`、`running`、`cancelled`）、意图或条数限制进行检索：
```bash
curl "http://localhost:5177/api/v1/runs?actionId=github.get-pr&limit=20" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **单个运行记录查询** (`GET /api/v1/runs/:runId`)：
```bash
curl http://localhost:5177/api/v1/runs/01JMB999ABCD... \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **取消在途任务** (`POST /api/v1/runs/:runId/cancel`)：
向执行中的任务发送中断信号，直通底层的 `ctx.signal` 终止异步操作：
```bash
curl -X POST http://localhost:5177/api/v1/runs/01JMB999ABCD.../cancel \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "用户手动终止" }'
```

- **批量清理运行历史** (`POST /api/v1/runs/clear`)：
```bash
curl -X POST http://localhost:5177/api/v1/runs/clear \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "actionId": "github.sync-all" }'
```

- **基于 Server-Sent Events 的实时状态流** (`GET /api/v1/runs/:runId/stream`)：
长任务可直接建立 SSE 连接接收实时进度与完成状态推送：
```bash
curl -N http://localhost:5177/api/v1/runs/01JMB999ABCD.../stream \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### AI 剧本工作流与规程检索

- **剧本列表检索** (`GET /api/v1/playbooks`)：
```bash
curl "http://localhost:5177/api/v1/playbooks?intent=deploy" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **剧本规程正文与元数据** (`GET /api/v1/playbooks/:id`)：
```bash
curl http://localhost:5177/api/v1/playbooks/sample.deploy-sop \
  -H "Authorization: Bearer sk-actiondock-secret"
```
响应中包含完整的规程 Markdown 正文与依赖动作序列。

---

### 状态存储管理 (`/api/v1/state`)

支持键值存储、命名空间隔离、生存时间设置与批量清理。

- **列出状态键名** (`GET /api/v1/state`)：
```bash
curl "http://localhost:5177/api/v1/state?namespace=session&package=test.app" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **读取指定状态** (`GET /api/v1/state/:key`)：
```bash
curl "http://localhost:5177/api/v1/state/user_token?namespace=session" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **写入或更新状态** (`PUT /api/v1/state/:key`)：
支持设定生存时间（秒）：
```bash
curl -X PUT http://localhost:5177/api/v1/state/user_token \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "value": { "token": "xyz123", "role": "admin" },
    "namespace": "session",
    "ttl": 3600
  }'
```

- **删除指定状态** (`DELETE /api/v1/state/:key`)：
```bash
curl -X DELETE "http://localhost:5177/api/v1/state/user_token?namespace=session" \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **按空间或全量清理状态** (`POST /api/v1/state/clear`)：
```bash
curl -X POST http://localhost:5177/api/v1/state/clear \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "namespace": "session" }'
```

---

### 配置治理与环境变量检测 (`/api/v1/config`)

- **查询当前配置清单** (`GET /api/v1/config`)：
敏感字段自动以掩码显示，安全可靠：
```bash
curl http://localhost:5177/api/v1/config \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **写入或更新配置项** (`PUT /api/v1/config/:key`)：
```bash
curl -X PUT http://localhost:5177/api/v1/config/API_ENDPOINT \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "value": "https://api.github.com" }'
```

- **删除配置项** (`DELETE /api/v1/config/:key`)：
```bash
curl -X DELETE http://localhost:5177/api/v1/config/API_ENDPOINT \
  -H "Authorization: Bearer sk-actiondock-secret"
```

- **环境变量满足率诊断** (`GET /api/v1/config/env`)：
检查目标包所声明的外部环境变量依赖在当前运行环境中是否完备：
```bash
curl http://localhost:5177/api/v1/config/env \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### 远程系统与环境深度体检 (`GET /api/v1/doctor`)

执行全套运行时、SQLite 读写就绪、注册表有效性及包依赖诊断并输出体检报告：

```bash
curl http://localhost:5177/api/v1/doctor \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### 一体化 Model Context Protocol 协议网关 (`/mcp`)

服务端内置原生 Model Context Protocol 网关。在启动 `ad serve` 时默认在同一端口上开启 `/mcp` 端点（可通过 `--no-mcp` 参数关闭）。

AI 客户端可直接将 MCP 服务器地址配置为：
`http://<host>:<port>/mcp`，并配合 Bearer Token 完成双向通信。

---

## 客户端与命令行透明调度

通过 CLI 的 `ad profile` 机制，可以在本地无感调度远端微服务：

```bash
# 注册远程云节点配置
ad profile add prod --server http://1.2.3.4:5177 --token "sk-actiondock-secret"

# 远程动作调度
ad run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 101}' --profile prod

# 远程能力自省与意图探索
ad info --profile prod
ad info -i github --profile prod
ad info --tree --profile prod

# 远程剧本浏览
ad playbook list --profile prod
ad playbook show github.review-pr --profile prod

# 远程任务历史与清理
ad runs list --profile prod
ad runs clear --action github.get-pr --profile prod

# 远程配置与状态管理
ad config list --profile prod
ad config set API_ENDPOINT "https://api.github.com" --profile prod
ad state list --profile prod

# 远程深度体检
ad doctor --profile prod
```
