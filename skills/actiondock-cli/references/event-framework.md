# ActionDock CLI Webhook 参考

## 当前模型

当前版本只保留一对一 Webhook：

- 一个 `webhook`
- 一个固定地址 `POST /api/webhooks/{id}`
- 一个已发布脚本 `webhookScriptId`

平台不再负责：

- 标准化
- 分发记录
- 一对多触发
- 请求转换

## Webhook定义最小模板

```json
{
  "id": "github-webhook",
  "key": "github.issue",
  "name": "GitHub Issue",
  "enabled": true,
  "transport": {
    "type": "HTTP_WEBHOOK"
  },
  "webhookScriptId": "script-github-webhook",
  "sampleRequest": {
    "method": "POST",
    "headers": {
      "X-GitHub-Event": ["issues"]
    },
    "query": {},
    "rawBody": "{\"action\":\"opened\"}",
    "contentType": "application/json"
  }
}
```

## Webhook 请求模板

```json
{
  "method": "POST",
  "path": "/api/webhooks/github-webhook",
  "headers": {
    "X-GitHub-Event": ["issues"]
  },
  "query": {
    "tenant": ["acme"]
  },
  "rawBody": "{\"action\":\"opened\"}",
  "contentType": "application/json"
}
```

## 脚本输入

Webhook 脚本收到：

```json
{
  "request": {
    "method": "POST",
    "path": "/api/webhooks/github-webhook",
    "headers": {
      "X-GitHub-Event": ["issues"]
    },
    "query": {
      "tenant": ["acme"]
    },
    "rawBody": "{\"action\":\"opened\"}",
    "contentType": "application/json"
  },
  "webhook": {
    "id": "github-webhook",
    "key": "github.issue",
    "name": "GitHub Issue"
  }
}
```

## 脚本输出

必须返回：

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

## CLI 命令

```bash
actiondock webhook create --definition-file ./webhook.json --json
actiondock webhook get <webhook-id> --json
actiondock webhook update <webhook-id> --definition-file ./webhook.json --json
actiondock webhook invoke <webhook-id> --payload-file ./webhook-request.json --json
actiondock execution get <execution-id> --json
```

## 排查顺序

1. 看 `webhook get <id>`，确认 `webhookScriptId`
2. 看 `webhook invoke <id>` 的返回
3. 看 `execution get <execution-id>`
