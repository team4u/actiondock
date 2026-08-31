# HTTP 远程微服务与 API 调度 (HTTP Service)

当需要将 Action Package 部署为微服务，供远程 AI Agent、Webhook 或前端业务系统调用时，可以使用 `ac serve` 启动 HTTP 调度服务。

---

## 启动 HTTP 服务

在包含 `actiondock.json` 的项目目录下执行：

```bash
# 启动在 8080 端口并设置 Bearer 鉴权 Token
ac serve --port 8080 --token "sk-actiondock-secret"
```

> **安全机制说明**：
> - 监听在非回环地址（如 `0.0.0.0`）时，强制要求传入 `--token` 保证安全。
> - 默认自带安全防御、请求大小限制与严格的恒定时间 Token 比对。

---

## 远程调用 API

### 同步调用 Action (POST `/actions/:id`)
```bash
curl -X POST http://localhost:8080/actions/github.get-pr \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{"repo": "team4u/actiondock", "prNumber": 1}'
```

返回响应：
```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "title": "feat: remote http runner",
    "state": "open"
  }
}
```

### 异步执行长任务 (POST `/actions/:id?async=true`)
对于耗时任务，可以传入 `async=true`：

```bash
curl -X POST "http://localhost:8080/actions/batch-job?async=true" \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{"dataset": "all"}'
```

服务端立即返回 `202 Accepted` 以及 `runId`：
```json
{
  "ok": true,
  "runId": "01JMB999...",
  "status": "running"
}
```

后续可通过 `GET /runs/01JMB999...` 查询执行进度或结果，或发送 `POST /runs/01JMB999.../cancel` 中断执行。

---

## 健康检查与元数据探查

```bash
# 探查服务状态
curl http://localhost:8080/health

# 获取所有公开的 Actions 清单与 Schema
curl http://localhost:8080/actions -H "Authorization: Bearer sk-actiondock-secret"
```
