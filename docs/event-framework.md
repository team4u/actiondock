# Webhook 指南

## 一句话理解

当前版本的 Webhook 非常直接：

1. 一个 Webhook 对应一个固定地址
2. 一个 Webhook 绑定一个已发布脚本
3. 请求原样交给脚本
4. 响应由脚本直接返回

平台不再负责预处理、鉴权、过滤、幂等或分发，也不再维护额外的分发流水模型。

## 地址

固定接收地址：

```text
POST /api/webhooks/{webhookId}
```

Dry-run 地址：

```text
POST /api/webhooks/{webhookId}/test-webhook
```

## 脚本输入

Webhook 脚本收到的输入固定为：

```json
{
  "request": {
    "method": "POST",
    "path": "/api/webhooks/source-1",
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
    "id": "source-1",
    "key": "github.issue",
    "name": "GitHub Issue"
  }
}
```

说明：

- `headers` 和 `query` 都是 `string[]`
- `rawBody` 始终保留原始文本
- 平台不做任何“便利转换”

## 脚本输出

脚本必须返回：

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

说明：

- `status` 必填，必须是数字
- `headers` 可选，值可以是字符串数组
- `body` 可选，可以是对象、字符串或 `null`

## Webhook 字段

最小 Webhook 定义：

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

## 现在不做什么

当前版本不包含：

- Event Trigger
- Event Record
- Event Dispatch
- 平台转换
- 平台级鉴权/验签
- 一对多分发

如果需要一对多触发，建议后续单独做内置队列能力；Webhook 脚本当前可以直接把数据写入共享状态或投递到后续独立队列。
