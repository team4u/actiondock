# 事件框架配置指南

本文只覆盖 ActionDock 的事件框架：

- `Event Source`
- `Event Trigger`
- `Processor`
- `Event Record`
- `Event Dispatch`

如果你只想把外部系统事件接到 ActionDock，并把事件稳定地转成脚本执行，这篇就是主文档。

## 入口

- 主文档入口： [ActionDock README](../README.md)
- 管理台入口：`触发器`
- 相关页面：
  - 事件源
  - 事件触发
  - 事件记录

## 一句话理解

事件框架做的事情是：

1. 外部系统把事件发到 `Event Source`
2. `Event Source` 做鉴权和标准化
3. `Event Trigger` 做过滤、幂等和入参生成
4. 最终转成已发布脚本执行
5. 全链路写入事件记录和分发记录，方便排障

## 架构总览

```text
External System
  ↓
POST /api/event-sources/{sourceId}/events
  ↓
Event Source
  - 鉴权
  - 原始事件保存
  - 标准化
  ↓
Normalized Event
  ↓
Event Trigger(s)
  - 过滤
  - 幂等
  - 入参生成
  ↓
Published Script Execution
  ↓
Execution Record
  ↓
Event Record / Dispatch Record
```

## 核心概念

### Event Source

事件源负责定义一个外部接入口：

- `key`：用户自定义唯一键，例如 `crm.customer.created`
- `transport`：当前第一版只支持 `HTTP_WEBHOOK`
- `auth`：鉴权方式
- `normalizationProcessor`：把原始请求转成统一事件

事件源不绑定脚本，它只负责“怎么进来”。

从当前版本开始，事件源还可以选择“怎么回给外部系统”：

- 不配置：保持平台默认响应
- 配置：按事件源级规则返回自定义 HTTP 响应

### Event Trigger

事件触发器负责定义：

- 哪个事件源进来后要处理
- 触发哪个已发布脚本
- 怎么过滤
- 怎么算幂等
- 怎么生成脚本入参

一个事件源可以对应多个触发器。

### Processor

Processor 是平台统一的处理逻辑抽象。第一版支持：

- `JSON_PATH`
- `TEMPLATE`
- `SCRIPT_REF`

其中：

- `JSON_PATH` 适合提取字段
- `TEMPLATE` 适合拼装结构
- `SCRIPT_REF` 适合复杂逻辑

## 最小工作流

### 第 1 步：创建事件源

先配置这几个最小字段：

- 名称
- `key`
- Webhook Endpoint
- 鉴权模式
- 标准化 Processor

建议先用 `NONE` 或 `HEADER_TOKEN` 跑通，再切到 `HMAC_SHA256`。

### 第 2 步：准备测试样例

在事件源页面里准备一份样例请求：

- Headers
- Query
- Body
- Raw Body

如果是 HMAC 鉴权，Raw Body 很重要。

### 第 3 步：创建事件触发器

选择：

- 事件源
- 目标脚本
- 过滤 Processor
- 幂等 Processor
- Input Processor
- 提交模式

### 第 4 步：先测试，再试运行

- `测试`：只看 Processor 输出，不真正执行目标脚本
- `试运行`：会真正创建一次执行记录

### 第 5 步：看事件记录和分发记录

如果没触发或触发失败，优先看：

- 事件记录
- 分发状态
- 错误信息

## 详细配置

### 1. Event Source 配置

#### 1.1 基础字段

- `name`：人类可读名称
- `key`：唯一业务键，推荐用稳定命名，例如 `crm.customer.created`
- `enabled`：是否启用
- `description`：用途说明

命名建议：

- 用小写
- 用点号分段
- 不要把供应商写死到代码枚举里

#### 1.2 Transport

第一版只支持：

```json
{
  "type": "HTTP_WEBHOOK"
}
```

系统会生成对应 Webhook 地址，外部系统直接 POST 到这个地址。

#### 1.3 Auth

当前支持四种模式：

- `NONE`
- `HEADER_TOKEN`
- `QUERY_TOKEN`
- `HMAC_SHA256`

建议：

- 内部系统：先用 `HEADER_TOKEN`
- 公开 Webhook：优先用 `HMAC_SHA256`

HMAC 推荐字段：

```json
{
  "mode": "HMAC_SHA256",
  "signatureHeader": "X-Signature",
  "signaturePrefix": "sha256=",
  "signaturePayload": "RAW_BODY",
  "timestampHeader": "X-Timestamp",
  "maxSkewSeconds": 300,
  "secretConfigKey": "event.crm.secret"
}
```

#### 1.4 Normalization Processor

标准化 Processor 的目标是把外部请求转成统一事件。

推荐最小输出：

```json
{
  "eventType": "customer.created",
  "eventId": "ext-123",
  "actor": "system",
  "subject": "customer-001",
  "timestamp": "2026-05-01T12:00:00Z"
}
```

如果只做简单映射，直接用 `JSON_PATH`。

如果要拼装字段，用 `TEMPLATE`。

如果要做复杂归一化、签名校验后再清洗字段，用 `SCRIPT_REF`。

#### 1.5 sampleContext

`sampleContext` 用来：

- 预置测试样例
- 让 Processor 保存时可做可执行性检查

建议至少包含：

```json
{
  "event": {
    "headers": {},
    "query": {},
    "body": {}
  }
}
```

#### 1.6 外部响应（可选）

默认情况下，外部系统调用：

```text
POST /api/event-sources/{sourceId}/events
```

会收到平台默认响应：

```json
{
  "status": 0,
  "msg": "已接收",
  "data": {
    "event": { "...": "..." },
    "dispatches": []
  }
}
```

如果外部系统要求固定的 HTTP 状态码、Header 或 Body，可以在事件源里启用“外部响应”。

配置项包括：

- `successStatus`：成功时返回的 HTTP 状态码
- `successHeaders`：成功时附加的响应头
- `responseProcessor`：生成最终响应 Body 的 Processor
- `errorResponse`：自定义响应链路失败时的兜底错误响应

注意：

- 这是**事件源级**配置，不是触发器级配置
- 只有在 `鉴权通过 + Content-Type 合法 + JSON 解析成功` 后，才会进入自定义响应逻辑
- 更早的错误（例如鉴权失败、请求体非法）仍然返回系统默认错误响应
- `responseProcessor` 输出必须是一个 JSON 对象

推荐理解方式：

```text
外部请求
  -> Event Source 鉴权 / 标准化
  -> Trigger 分发 / 脚本执行
  -> responseProcessor 读取事件与执行结果
  -> 组装返回给外部系统的 Body
```

如果你不需要对接第三方固定协议，不要开这个配置。

#### 1.7 responseProcessor 能拿到什么

`responseProcessor` 的输入上下文里，重点可用这些字段：

- `event`：标准化后的事件
- `headers` / `query` / `body`：标准化事件中的对应字段
- `source`：当前事件源基础信息
- `variables.dispatches`：所有触发器的分发结果
- `variables.executions`：所有同步触发器的执行结果

其中：

- `variables.dispatches` 适合判断哪些触发器命中了、是否重复、是否失败
- `variables.executions` 适合读取同步脚本的输出，拼成外部系统要求的返回格式

如果你想在响应里使用脚本输出，对应触发器必须使用 `SYNC` 提交模式；`ASYNC` 执行结果不会参与本次 HTTP 返回。

一个简化后的输入示例如下：

```json
{
  "event": {
    "id": "event-record-1",
    "sourceId": "source-1",
    "sourceKey": "employee.offboard",
    "eventType": "employee.offboarded",
    "eventId": "ext-1001",
    "actor": "hr-system",
    "subject": "user-9527",
    "timestamp": "2026-05-08T12:00:00Z",
    "headers": {
      "X-Request-Id": "req-1"
    },
    "query": {},
    "body": {
      "employeeId": "9527",
      "email": "user@example.com"
    },
    "receivedAt": "2026-05-08T12:00:01"
  },
  "headers": {
    "X-Request-Id": "req-1"
  },
  "query": {},
  "body": {
    "employeeId": "9527",
    "email": "user@example.com"
  },
  "source": {
    "id": "source-1",
    "key": "employee.offboard",
    "name": "减员回调",
    "webhookResponseEnabled": true
  },
  "trigger": {},
  "variables": {
    "dispatches": [
      {
        "id": "dispatch-1",
        "eventId": "event-record-1",
        "sourceId": "source-1",
        "triggerId": "trigger-disable-account",
        "targetScriptId": "disable-account-script",
        "status": "EXECUTION_CREATED",
        "filterMatched": true,
        "idempotencyKey": "ext-1001",
        "mappedInput": {
          "employeeId": "9527"
        },
        "executionId": "exec-1",
        "executionStatus": "SUCCESS",
        "errorMessage": null,
        "createdAt": "2026-05-08T12:00:01",
        "updatedAt": "2026-05-08T12:00:02"
      },
      {
        "id": "dispatch-2",
        "eventId": "event-record-1",
        "sourceId": "source-1",
        "triggerId": "trigger-send-mail",
        "targetScriptId": "send-mail-script",
        "status": "FILTERED_OUT",
        "filterMatched": false,
        "idempotencyKey": null,
        "mappedInput": {},
        "executionId": null,
        "executionStatus": null,
        "errorMessage": null,
        "createdAt": "2026-05-08T12:00:01",
        "updatedAt": "2026-05-08T12:00:01"
      }
    ],
    "executions": [
      {
        "executionId": "exec-1",
        "triggerId": "trigger-disable-account",
        "scriptId": "disable-account-script",
        "status": "SUCCESS",
        "submitMode": "SYNC",
        "input": {
          "employeeId": "9527"
        },
        "output": {
          "result": "disabled",
          "ticketId": "IAM-100"
        },
        "rawOutput": {
          "result": "disabled",
          "ticketId": "IAM-100",
          "internalTraceId": "trace-abc"
        },
        "errorMessage": null,
        "logs": [
          {
            "level": "INFO",
            "message": "disable account done",
            "timestamp": "2026-05-08T12:00:02"
          }
        ],
        "createdAt": "2026-05-08T12:00:01",
        "startedAt": "2026-05-08T12:00:01",
        "finishedAt": "2026-05-08T12:00:02"
      }
    ]
  }
}
```

可以这样理解：

- `event`：标准化后的主事件
- `dispatches`：每个触发器有没有命中、有没有创建执行、失败在哪一步
- `executions`：同步执行脚本的结果，适合直接拿来拼回包

典型用法：

- 外部只要知道“有没有接收” -> 读 `event.eventId`
- 外部要知道“命中了哪个处理链路” -> 读 `variables.dispatches[*].triggerId`
- 外部要拿业务返回值 -> 读 `variables.executions[0].output`

#### 1.7.1 透传示例

如果你的“投产触发器”已经是 `SYNC`，并且目标脚本本身输出的结构就是外部系统要的结构，那么最简单的做法就是透传它的输出。

例如，目标脚本执行成功后返回：

```json
{
  "success": true,
  "code": "OK",
  "message": "employee offboarded",
  "data": {
    "employeeId": "9527",
    "accountDisabled": true,
    "ticketId": "IAM-100"
  }
}
```

那么事件源的 `responseProcessor` 可以直接写成：

```json
{
  "mode": "SCRIPT_REF",
  "scriptRef": {
    "scriptId": "webhook-response-pass-through",
    "versionMode": "PUBLISHED"
  }
}
```

对应的响应脚本逻辑可以很简单：

```groovy
def executions = (input.variables?.executions ?: []) as List
if (executions.isEmpty()) {
    return [
        success: false,
        code: "NO_SYNC_RESULT",
        message: "no synchronous execution result"
    ]
}

def first = executions[0] ?: [:]
return (first.output ?: [:]) as Map
```

这样，外部系统最终收到的 HTTP Body 就是：

```json
{
  "success": true,
  "code": "OK",
  "message": "employee offboarded",
  "data": {
    "employeeId": "9527",
    "accountDisabled": true,
    "ticketId": "IAM-100"
  }
}
```

适用场景：

- 你的业务脚本已经输出了外部要求的最终结构
- 不需要再额外拼装平台字段
- 只需要把“投产触发器”的同步结果直接回给调用方

如果外部还要求额外字段，比如：

- 网关侧固定 `requestId`
- 统一 `ackTime`
- 平台内部 `eventId`

那就不要完全透传，而是在响应脚本里做“半透传”：

```groovy
def executions = (input.variables?.executions ?: []) as List
def result = executions ? (executions[0].output ?: [:]) : [:]

return [
    requestId: input.headers?.get("X-Request-Id"),
    eventId: input.event?.eventId,
    ackTime: input.event?.receivedAt,
    result: result
]
```

最终返回给外部系统的结构就会变成：

```json
{
  "requestId": "req-1",
  "eventId": "ext-1001",
  "ackTime": "2026-05-08T12:00:01",
  "result": {
    "success": true,
    "code": "OK",
    "message": "employee offboarded",
    "data": {
      "employeeId": "9527",
      "accountDisabled": true,
      "ticketId": "IAM-100"
    }
  }
}
```

#### 1.8 一个最小示例

假设外部系统要求收到：

```json
{
  "accepted": true,
  "code": "OK"
}
```

那么可以把事件源响应配置成：

```json
{
  "successStatus": 202,
  "successHeaders": {
    "X-Ack": "ok"
  },
  "responseProcessor": {
    "mode": "TEMPLATE",
    "template": {
      "engine": "MUSTACHE",
      "template": {
        "accepted": true,
        "code": "OK"
      }
    }
  },
  "errorResponse": {
    "httpStatus": 503,
    "msg": "响应生成失败",
    "data": {
      "code": "WEBHOOK_RESPONSE_FAILED"
    }
  }
}
```

这个示例适合：

- 外部只要求固定 ACK
- 不关心具体触发器执行结果

如果外部要求把脚本执行结果塞回响应，就把 `responseProcessor` 改成 `SCRIPT_REF`，在脚本里读取 `variables.executions`。

### 2. Event Trigger 配置

#### 2.1 基础字段

- `name`
- `description`
- `enabled`
- `sourceId`
- `targetScriptId`

其中 `targetScriptId` 对应的脚本必须已经发布。

#### 2.2 Filter Processor

过滤 Processor 决定“要不要触发”。

约定输出：

```json
{
  "matched": true
}
```

规则：

- `matched = true`：继续往下走
- `matched = false`：直接跳过

#### 2.3 Idempotency Processor

幂等 Processor 决定“是不是重复事件”。

约定输出：

```json
{
  "key": "ext-123"
}
```

建议：

- 使用外部事件 ID
- 或者使用业务主键 + 事件类型组合

#### 2.4 Input Processor

Input Processor 决定最终怎么喂给目标脚本。

约定输出必须是目标脚本 `inputSchema` 能接受的对象。

建议先做成最简单的映射，再逐步引入脚本处理。

#### 2.5 提交模式

- `SYNC`：需要同步拿结果时使用
- `ASYNC`：默认更安全，适合事件驱动

如果只是通知、归档、入库类动作，优先 `ASYNC`。

### 3. Processor 配置

#### 3.1 JSON_PATH

适合字段提取。

```json
{
  "mode": "JSON_PATH",
  "jsonPath": {
    "fields": {
      "eventId": "$.body.id",
      "eventType": "$.headers.X-Event-Type",
      "actor": "$.body.user.name"
    }
  }
}
```

#### 3.2 TEMPLATE

适合拼装输出对象。

```json
{
  "mode": "TEMPLATE",
  "template": {
    "engine": "MUSTACHE",
    "template": {
      "subject": "{{body.customer.name}}",
      "summary": "[{{body.type}}] {{body.customer.name}}"
    }
  }
}
```

#### 3.3 SCRIPT_REF

适合复杂逻辑。

处理器脚本输入里通常会拿到：

- `event`
- `headers`
- `query`
- `body`
- `source`
- `trigger`

输出必须是一个对象。

## UI 使用顺序

### 事件源页

先看这几块：

- `Key`
- `Webhook Endpoint`
- `鉴权配置`
- `标准化 Processor`
- `外部响应`
- `调试面板`

使用建议：

1. 先完成 `鉴权配置` 和 `标准化 Processor`
2. 用 `调试面板` 跑通标准化
3. 确认触发器链路可用
4. 最后再开启 `外部响应`

这样排障最清晰，不会把“没进来”和“回包不对”混在一起。

### 事件触发页

先看这几块：

- `事件源`
- `目标脚本`
- `过滤 Processor`
- `幂等 Processor`
- `Input Processor`
- `测试面板`

### 事件记录页

点进一条记录后先看：

- 原始请求
- 标准事件
- 分发记录

如果链路中断，通常就能在这里定位到问题。

## API 参考

### Event Source

- `GET /api/event-sources`
- `POST /api/event-sources`
- `GET /api/event-sources/{id}`
- `PUT /api/event-sources/{id}`
- `POST /api/event-sources/{id}/test-normalization`
- `POST /api/event-sources/{id}/events`

### Event Trigger

- `GET /api/event-triggers`
- `POST /api/event-triggers`
- `GET /api/event-triggers/{id}`
- `PUT /api/event-triggers/{id}`
- `POST /api/event-triggers/{id}/test`
- `GET /api/event-triggers/{id}/dispatches`

### Event Record

- `GET /api/event-records`
- `GET /api/event-records/{id}`
- `GET /api/event-records/{id}/dispatches`

### Processor

- `POST /api/processors/test`

## 常见问题

### 1. 保存失败，提示目标脚本未发布

说明 `targetScriptId` 指向的脚本还不是发布状态。先发布脚本，再保存触发器。

### 2. 测试不命中

优先检查：

- Filter Processor 的 `matched`
- 事件样例是否有正确字段
- 事件源的 `sampleContext` 是否合理

### 3. 重复触发

优先检查幂等 Processor 的 `key` 是否稳定，是否真的代表同一个外部事件。

### 4. 试运行报 schema 校验失败

说明 Input Processor 的输出和目标脚本 `inputSchema` 不匹配。先修输入结构，再试运行。

### 5. 事件没进来

优先检查：

- Webhook 地址是否正确
- 鉴权配置是否匹配外部系统
- 外部系统是不是发了 JSON

### 6. 外部响应没按预期返回

优先检查：

- 事件源是否真的开启了 `外部响应`
- `responseProcessor` 是否返回了对象
- 是否错误地依赖了 `ASYNC` 触发器结果
- 兜底 `errorResponse` 是否被触发

经验上：

- 需要固定 ACK：优先用 `TEMPLATE`
- 需要拼复杂结构：用 `SCRIPT_REF`
- 需要读脚本输出：对应触发器改成 `SYNC`

## 推荐实践

- `Event Source` 只做接入和标准化，不要把业务分支写死在这里
- `Event Trigger` 只做触发规则和入参生成，不要混入过重业务逻辑
- 复杂变换优先放到 `SCRIPT_REF`
- 幂等 key 要稳定且可解释
- 先用测试面板跑通，再接真实流量
