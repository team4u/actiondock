# Webhook 与定时任务

## 一句话理解

当前“触发”能力只保留两类入口：

- 定时任务
- Webhook

其中 Webhook 的模型已经收口为“一个地址对应一个脚本”。

## 管理台入口

- Webhook：管理固定地址与脚本绑定关系
- 定时任务：管理 Cron 触发

## Webhook

### 核心规则

- 一个 Webhook 对应一个固定地址
- 一个 Webhook 绑定一个已发布脚本
- 请求原样传给脚本
- 响应由脚本直接返回

### 地址

```text
POST /api/webhooks/{id}
```

### Dry-run

```text
POST /api/webhooks/{id}/test-webhook
```

### 脚本输入

```json
{
  "request": {
    "method": "POST",
    "path": "/api/webhooks/source-1",
    "headers": {},
    "query": {},
    "rawBody": "{\"hello\":\"world\"}",
    "contentType": "application/json"
  },
  "webhook": {
    "id": "source-1",
    "key": "demo.webhook",
    "name": "Demo Webhook"
  }
}
```

### 脚本输出

```json
{
  "status": 200,
  "headers": {
    "Content-Type": ["application/json;charset=UTF-8"]
  },
  "body": {
    "ok": true
  }
}
```

## 定时任务

定时任务通过：

- `GET /api/schedules`
- `POST /api/schedules`
- `PUT /api/schedules/{id}`
- `DELETE /api/schedules/{id}`

管理脚本的 Cron 触发。
