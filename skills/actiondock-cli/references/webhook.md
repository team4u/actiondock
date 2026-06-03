# ActionDock CLI Webhook 参考

先遵守 `references/common.md`。

完整 Webhook 链路固定顺序：创建并发布 Webhook 脚本、创建 `webhook`、`webhook invoke`、`execution get`。

Webhook 相关对象优先使用 `--definition-file`、`--payload-file`，不要把大段 JSON 直接内联到命令里。`webhook update` 按 CLI 侧“先读取当前对象，再深度合并 patch，再 PUT”理解，不要假设服务端自动局部合并。

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

## Webhook 定义最小模板

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
actiondock webhook list --intent "<regex>" --json
actiondock webhook create --definition-file ./webhook.json --json
actiondock webhook get <webhook-id> --json
actiondock webhook update <webhook-id> --definition-file ./webhook.json --json
actiondock webhook invoke <webhook-id> --payload-file ./webhook-request.json --json
actiondock execution get <execution-id> --json --output-file /tmp/actiondock-webhook-execution.json --overwrite-output
```

`webhook list --intent` 按 Webhook ID、key、名称、描述和绑定脚本 ID 做正则搜索。

## 排查顺序

1. 不确定 Webhook ID 时先用 `webhook list --intent "<regex>"` 缩小候选
2. 看 `webhook get <id>`，确认 `webhookScriptId`
3. 看 `webhook invoke <id>` 的返回
4. 看 `execution get <execution-id>`
