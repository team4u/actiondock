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
- `调试面板`

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

## 推荐实践

- `Event Source` 只做接入和标准化，不要把业务分支写死在这里
- `Event Trigger` 只做触发规则和入参生成，不要混入过重业务逻辑
- 复杂变换优先放到 `SCRIPT_REF`
- 幂等 key 要稳定且可解释
- 先用测试面板跑通，再接真实流量
