# 实践指南：HTTP 服务与远程调度

`ac serve` 命令用于将当前 Action Package 启动为轻量、安全的 HTTP 微服务，方便跨机器或多云环境调用。

---

## 1. 启动 HTTP 服务

```bash
# 启动本地开发服务（默认监听 127.0.0.1:3000）
ac serve

# 启动对外服务并启用 Token 鉴权
ac serve --host 0.0.0.0 --port 8080 --token my-super-secret-token
```

> **安全底线**：当绑定非回环地址（如 `0.0.0.0` 或局域网 IP）时，ActionDock 强制要求必须配置 `--token` 或设置 `ACTIONDOCK_SERVER_TOKEN` 环境变量，否则拒绝启动。

---

## 2. HTTP REST API 端点

所有接口均支持 `Authorization: Bearer <token>` 请求头或 `?token=<token>` 参数。

### A. 健康检查
```http
GET /health
```
响应：`200 {"status":"ok","version":"2.0.0","uptime":123}`

### B. 查询包信息与 Action 列表
```http
GET /info
GET /actions
```

### C. 同步执行 Action
```http
POST /actions/github.get-pr/run
Content-Type: application/json

{
  "input": {
    "repo": "team4u/actiondock",
    "prNumber": 1
  }
}
```
响应：
```json
{
  "ok": true,
  "runId": "01JM8A...",
  "data": {
    "id": 1,
    "title": "feat: init"
  }
}
```

### D. 异步长任务执行 (Async Mode)
添加 `?async=true` 或在 body 中传入 `"async": true`：
```http
POST /actions/github.batch-sync/run?async=true
```
响应：`202 Accepted`
```json
{
  "ok": true,
  "runId": "01JM8B...",
  "status": "running"
}
```

### E. 查询与取消运行中的任务
```http
# 查询状态
GET /runs/01JM8B...

# 取消任务（触发 ActionContext 的 signal 中断）
POST /runs/01JM8B.../cancel
```
