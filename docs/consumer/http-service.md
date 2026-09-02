# HTTP 远程微服务与 API 调度 (HTTP Service)

当需要将 ActionDock 部署为微服务，供远程 AI Agent、Webhook、CI/CD 流水线或前端业务系统远程调度时，可以使用 `ac serve` 启动轻量级 HTTP 调度微服务。

---

## 4 种启动姿态 (Startup Modes)

`ac serve` 具备高度灵活性，无需局限在特定项目目录下运行：

### 姿态 1：全局路由模式（推荐，任意目录直接启动）
在系统的**任意终端路径**直接执行 `ac serve`。服务端会自动启动为 **Global Registry Mode**，一键聚合当前系统通过 `ac link` 注册的所有 Action Packages 与 Workspaces：

```bash
# 启动在 5177 端口（默认）并设置安全 Token
ac serve --port 5177 --token "sk-actiondock-secret"
```
终端输出示例：
```text
======================================================
  ActionDock 2.0 HTTP Runner Server
======================================================
  * Listening on:    http://127.0.0.1:5177
  * Project:         Global Registry Mode
  * Authentication:  Bearer Token / Query Token Enabled
  * Health Endpoint: http://127.0.0.1:5177/api/v1/health
======================================================
```
> 远程客户端可以通过 `Package-Qualified ID`（例如 `github-tools/github.get-pr`）调度全局任意包中的工具。

---

### 姿态 2：单包项目模式（在包项目目录内）
在包含 `actiondock.json` 的项目目录内运行：

```bash
cd examples/github-tools
ac serve --port 8080 --token "sk-actiondock-secret"
```
服务将专属绑定该项目，默认直接暴露该包下的所有 Actions 与 Playbooks。

---

### 姿态 3：跨目录指定路径 (`-d, --dir`)
无需 `cd` 切换目录，在任意路径通过 `-d` 参数指定目标 Action Package 目录：

```bash
ac serve -d ./examples/github-tools --port 8080 --token "sk-actiondock-secret"
```

---

### 姿态 4：独立单文件二进制运行（目标环境零依赖）
对于通过 `ac build` 编译生成的独立可执行文件，可在未安装 Bun 或 Node.js 的服务器/容器中直接以服务模式启动：

```bash
./dist/bin/github-tools serve --port 8080 --token "sk-actiondock-secret"
```

---

## 安全防御机制

1. **非回环地址强制 Token 认证**：当监听在 `0.0.0.0` 或外网 IP 时，强制要求配置 `--token`（或通过环境变量 `ACTIONDOCK_TOKEN` 注入），否则拒绝启动。
2. **防时序攻击比对**：内置基于 `crypto.timingSafeEqual` 的常数时间 Token 校验，彻底杜绝旁路分析。
3. **请求体大小防护**：默认限制单个 JSON 请求体上限为 1MB（可通过 `--max-body 10mb` 调整），超限返回 `413 Payload Too Large`。
4. **CORS 策略**：默认关闭跨域，可通过 `--cors-origin <origin>` 显式添加白名单源。

---

## 标准 REST API 调度规范

所有接口均支持通过 Header `Authorization: Bearer <token>` 或 URL 参数 `?token=<token>` 进行身份鉴权。

### 1. 健康检查与就绪探查 (`GET /api/v1/health`)
```bash
curl http://localhost:5177/api/v1/health \
  -H "Authorization: Bearer sk-actiondock-secret"
```
响应示例：
```json
{
  "status": "ok",
  "version": "2.0.0",
  "timestamp": "2026-09-02T12:00:00.000Z",
  "uptime": 12.34
}
```

---

### 2. 检索可用 Actions 清单 (`GET /api/v1/actions`)
支持通过 `?intent=<pattern>` 进行关键词或正则模糊检索：

```bash
curl "http://localhost:5177/api/v1/actions?intent=github" \
  -H "Authorization: Bearer sk-actiondock-secret"
```
响应示例：
```json
[
  {
    "id": "github.get-pr",
    "description": "获取指定 GitHub 仓库的 Pull Request 详细信息",
    "packageId": "team4u.github-tools"
  },
  {
    "id": "github.list-prs",
    "description": "列出指定 GitHub 仓库的 Pull Request 清单",
    "packageId": "team4u.github-tools"
  }
]
```

---

### 3. 同步执行 Action (`POST /api/v1/actions/:id/run`)
向目标 Action 投递参数，服务端同步阻塞执行完毕后返回标准 JSON Envelope：

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
响应示例：
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

---

### 4. 异步长任务调度 (`POST /api/v1/actions/:id/run` with async)
对于长耗时 Action（如全量数据备份、大模型深度分析、批量扫描），在请求体中传入 `"execution": { "mode": "async" }`：

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
服务端立即返回 `202 Accepted` 以及在途任务的 `runId`：
```json
{
  "ok": true,
  "runId": "01JMB999ABCD...",
  "status": "running"
}
```

---

### 5. 查询任务状态与历史 (`GET /api/v1/runs/:runId`)
```bash
curl http://localhost:5177/api/v1/runs/01JMB999ABCD... \
  -H "Authorization: Bearer sk-actiondock-secret"
```
响应示例：
```json
{
  "ok": true,
  "run": {
    "id": "01JMB999ABCD...",
    "actionId": "github.sync-all",
    "status": "SUCCESS",
    "durationMs": 4521,
    "createdAt": "2026-09-02T12:00:00.000Z",
    "output": { ... }
  }
}
```

---

### 6. 取消在途任务 (`POST /api/v1/runs/:runId/cancel`)
对于执行中的异步任务，可随时发送取消指令（直通底层的 `ctx.signal` 中断 I/O）：

```bash
curl -X POST http://localhost:5177/api/v1/runs/01JMB999ABCD.../cancel \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "用户手动中断" }'
```

---

## 配合 `ac profile` 实现 CLI 远程透明调度

开发者本地 CLI 可以配置远程节点的 Profile，之后所有 `ac run` 命令即可像本地一样透明调度远端微服务：

```bash
# 1. 注册远程云节点 Profile
ac profile add prod --server http://1.2.3.4:5177 --token "sk-actiondock-secret"

# 2. 像本地一样远程调度 Action
ac run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 101}' --profile prod
```
