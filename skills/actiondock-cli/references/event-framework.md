# 事件框架

当任务涉及下面命令时，读取本文件：

- `event-source`
- `event-trigger`
- `event-record`
- `processor test`

这是给 AI 用的操作手册，不是给人看的说明文档。

## 加载顺序

1. 如果要用 `SCRIPT_REF`，同时读取 `references/script-authoring.md`。
2. 如果处理器脚本还会调用插件或脚本，再读取 `references/script-runtime-calls.md`。
3. 优先用文件输入，不要把大段 JSON 直接内联进命令。

## 固定流程

默认按下面顺序执行，除非用户明确要求改顺序：

1. 如果目标脚本已存在，先执行：

```bash
actiondock script schema <target-script-id> --json
```

2. 如果要用 `SCRIPT_REF`，先创建并发布处理器脚本。
3. 创建事件源。
4. 测试标准化。
5. 创建事件触发器。
6. 测试触发器。
7. 需要的话，用 `--execute` 连目标脚本一起试跑。
8. 真实接收事件。
9. 检查事件记录、分发记录和执行记录。

## 文件清单

使用下面这些文件：

```text
./processor.py
./processor-input-schema.json
./processor-output-schema.json
./event-source.json
./event-trigger.json
./event.raw.json
./event.normalized.json
```

可选文件：

```text
./processor-context.json
./target-script-input-schema.json
```

## 契约规则

### Event Source

- `key` 由用户自定义，且必须唯一。
- 第一版 transport 只支持 `HTTP_WEBHOOK`。
- 鉴权模式包括：`NONE`、`HEADER_TOKEN`、`QUERY_TOKEN`、`HMAC_SHA256`。
- `normalizationProcessor` 必须输出标准化事件对象。

### Event Trigger

- `sourceId` 必须指向已存在的事件源。
- `targetScriptId` 必须指向已发布脚本。
- `filterProcessor` 输出里应包含 `matched`。
- `idempotencyProcessor` 输出里应包含 `key`。
- `inputProcessor` 输出必须匹配目标脚本的 `inputSchema`。

### Processor

第一版支持：

- `JSON_PATH`
- `TEMPLATE`
- `SCRIPT_REF`

建议：

- `JSON_PATH` 用于字段提取
- `TEMPLATE` 用于轻量拼装
- `SCRIPT_REF` 用于复杂逻辑

## 最小模板

### 事件源

```json
{
  "id": "source-github-issue",
  "key": "github.issue",
  "name": "GitHub Issue",
  "enabled": true,
  "transport": {
    "type": "HTTP_WEBHOOK"
  },
  "auth": {
    "mode": "HMAC_SHA256",
    "signatureHeader": "X-Hub-Signature-256",
    "signaturePrefix": "sha256=",
    "signaturePayload": "RAW_BODY",
    "secretConfigKey": "github.webhook.secret"
  },
  "normalizationProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "eventType": "$.headers.X-GitHub-Event",
        "eventId": "$.headers.X-GitHub-Delivery",
        "actor": "$.body.sender.login",
        "subject": "$.body.issue.title"
      }
    }
  }
}
```

### 事件触发器

```json
{
  "id": "trigger-github-issue",
  "name": "GitHub Issue Classifier",
  "enabled": true,
  "sourceId": "source-github-issue",
  "targetScriptId": "github-issue-classifier",
  "filterProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "matched": "$.body.action"
      }
    }
  },
  "idempotencyProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "key": "$.eventId"
      }
    }
  },
  "inputProcessor": {
    "mode": "SCRIPT_REF",
    "scriptRef": {
      "scriptId": "processor-github-issue",
      "versionMode": "PUBLISHED"
    }
  },
  "submitMode": "ASYNC",
  "responseView": "RESULT"
}
```

### 原始事件

```json
{
  "headers": {
    "X-GitHub-Event": "issues",
    "X-GitHub-Delivery": "delivery-001"
  },
  "query": {},
  "body": {
    "action": "opened",
    "issue": {
      "title": "Login failed",
      "body": "error details"
    },
    "sender": {
      "login": "octocat"
    }
  }
}
```

### 标准化事件

```json
{
  "sourceId": "source-github-issue",
  "sourceKey": "github.issue",
  "eventType": "issues",
  "eventId": "delivery-001",
  "actor": "octocat",
  "subject": "Login failed",
  "headers": {},
  "query": {},
  "body": {}
}
```

### 处理器脚本

Python：

```python
event = input.get("event", {})
body = event.get("body", {})

return {
    "title": body.get("issue", {}).get("title"),
    "author": body.get("sender", {}).get("login")
}
```

Groovy：

```groovy
def event = input.event ?: [:]
def body = event.body ?: [:]

return [
  title: body.issue?.title,
  author: body.sender?.login
]
```

## 命令集

```bash
actiondock event-source create --definition-file ./event-source.json --json
actiondock event-source test-normalization <source-id> --payload-file ./event.raw.json --json
actiondock event-trigger create --definition-file ./event-trigger.json --json
actiondock event-trigger test <trigger-id> --event-file ./event.normalized.json --json
actiondock event-trigger test <trigger-id> --event-file ./event.normalized.json --execute --json
actiondock event-source ingest <source-id> --payload-file ./event.raw.json --json
actiondock event-record list --source-id <source-id> --json
actiondock event-record get <event-record-id> --json
actiondock event-record dispatches <event-record-id> --json
actiondock event-trigger dispatches <trigger-id> --json
actiondock execution get <execution-id> --json
```

## 优先检查什么

- 标准化不对：看事件源 processor 或原始 payload
- 没命中过滤：看 `matched`
- 重复分发：看幂等 `key`
- schema 校验失败：看 trigger 的 `inputProcessor` 输出和目标脚本 `inputSchema`
- 没有事件进入：看 webhook 地址、鉴权配置、原始 body 格式

## 不要做什么

- 不要在代码里硬编码供应商类型。
- 不要在第一版使用 inline code。
- 使用 `SCRIPT_REF` 时不要跳过脚本发布步骤。
- 除非用户要求完整重做，不要同时改 source 和 trigger。

---

## 7. 可直接复用的模板

### 7.1 通用 Header Token 事件源

```json
{
  "id": "source-internal-crm",
  "key": "internal.crm.customer-created",
  "name": "Internal CRM Customer Created",
  "enabled": true,
  "transport": {
    "type": "HTTP_WEBHOOK",
    "contentTypes": ["application/json"]
  },
  "auth": {
    "mode": "HEADER_TOKEN",
    "tokenHeader": "X-ActionDock-Token",
    "secretConfigKey": "internal.crm.webhook.token"
  },
  "normalizationProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "eventType": "$.body.type",
        "eventId": "$.body.id",
        "actor": "$.body.user.name",
        "subject": "$.body.customer.name"
      }
    }
  }
}
```

### 7.2 GitHub Issue 事件源

```json
{
  "id": "source-github-issue",
  "key": "github.issue",
  "name": "GitHub Issue",
  "enabled": true,
  "transport": {
    "type": "HTTP_WEBHOOK"
  },
  "auth": {
    "mode": "HMAC_SHA256",
    "signatureHeader": "X-Hub-Signature-256",
    "signaturePrefix": "sha256=",
    "signaturePayload": "RAW_BODY",
    "secretConfigKey": "github.webhook.secret"
  },
  "normalizationProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "eventType": "$.headers.X-GitHub-Event",
        "eventId": "$.headers.X-GitHub-Delivery",
        "actor": "$.body.sender.login",
        "subject": "$.body.issue.title"
      }
    }
  }
}
```

### 7.3 最小事件触发器

```json
{
  "id": "trigger-github-issue",
  "name": "GitHub Issue 分类",
  "enabled": true,
  "sourceId": "source-github-issue",
  "targetScriptId": "github-issue-classifier",
  "filterProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "matched": "$.body.action"
      }
    }
  },
  "idempotencyProcessor": {
    "mode": "JSON_PATH",
    "jsonPath": {
      "fields": {
        "key": "$.eventId"
      }
    }
  },
  "inputProcessor": {
    "mode": "SCRIPT_REF",
    "scriptRef": {
      "scriptId": "processor-github-issue",
      "versionMode": "PUBLISHED"
    }
  },
  "submitMode": "ASYNC",
  "responseView": "RESULT"
}
```

### 7.4 处理器脚本上下文

`SCRIPT_REF` 处理器脚本默认拿到的是：

```json
{
  "event": {
    "sourceKey": "github.issue",
    "eventType": "opened",
    "eventId": "delivery-1",
    "headers": {},
    "query": {},
    "body": {}
  }
}
```

返回值必须是目标脚本的入参对象，而不是整条事件对象。

### 7.5 处理器脚本最小模板

Groovy：

```groovy
def event = input.event ?: [:]
def body = event.body ?: [:]

return [
  sourceKey: event.sourceKey,
  eventType: event.eventType,
  eventId: event.eventId,
  actor: event.actor,
  subject: event.subject,
  title: body.issue?.title,
  author: body.sender?.login
]
```

Python：

```python
event = input.get("event", {})
body = event.get("body", {})
issue = body.get("issue", {})

return {
    "sourceKey": event.get("sourceKey"),
    "eventType": event.get("eventType"),
    "eventId": event.get("eventId"),
    "actor": event.get("actor"),
    "subject": event.get("subject"),
    "title": issue.get("title"),
    "author": body.get("sender", {}).get("login"),
}
```
