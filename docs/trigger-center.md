# 触发中心

## 一句话理解

触发中心管理所有"自动执行"的方式：定时任务（Cron）和事件驱动（Webhook）。定时任务让脚本按时间计划自动运行；事件驱动让外部系统通过 Webhook 发送事件，经过过滤、幂等处理后触发脚本执行。全链路有事件记录和分发记录，方便排查。

## 架构总览

```text
┌─────────────────────────────────────────────┐
│                 定时任务                      │
│  Cron 表达式 → ScriptSchedule → 脚本执行     │
│  (按时间触发)                                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│                 事件驱动                      │
│                                              │
│  外部系统                                     │
│    │                                         │
│    ▼ POST /api/event-sources/{id}/events     │
│  ┌────────────┐                             │
│  │ Event Source│ ← 鉴权 + 标准化              │
│  └─────┬──────┘                             │
│        │ Normalized Event                    │
│        ▼                                     │
│  ┌──────────────┐                            │
│  │ Event Trigger│ ← 过滤 + 幂等 + 入参生成    │
│  └──────┬───────┘                            │
│         │                                    │
│         ▼                                    │
│  已发布脚本执行                                │
│         │                                    │
│         ▼                                    │
│  ┌──────────────┐                            │
│  │ Event Record  │ ← 全链路记录               │
│  │ Dispatch Record│                          │
│  └──────────────┘                            │
└─────────────────────────────────────────────┘
```

> 事件框架的详细配置指南请参考 [事件框架配置指南](event-framework.md)。

## 触发中心页面

路径：管理台 → 触发 → 触发中心

| 标签页 | 功能 |
|--------|------|
| 定时触发 | Cron 定时任务管理 |
| 事件源 | 外部 Webhook 接入口定义 |
| 事件触发 | 事件到脚本的路由规则 |
| 事件记录 | 事件接收和分发历史 |

## 定时任务

### 数据模型

```java
public class ScriptSchedule {
    private String id;               // 调度标识
    private String name;             // 调度名称
    private String scriptId;         // 关联的已发布脚本
    private String cronExpression;   // 标准 5 字段 Cron
    private String timeZone;         // 时区（可选）
    private Map<String, Object> input;  // 固定输入参数
    private boolean enabled;         // 是否启用
    private LocalDateTime lastExecutedAt;  // 上次执行时间
    private LocalDateTime nextExecutionAt; // 下次执行时间
}
```

### 创建定时任务

路径：管理台 → 触发 → 触发中心 → 定时触发

| 字段 | 说明 | 示例 |
|------|------|------|
| 脚本 ID | 选择已发布的脚本（必须为 PUBLISHED 状态） | `data-cleanup` |
| 调度名称 | 人类可读名称 | `每日凌晨数据清理` |
| Cron 表达式 | 标准 5 字段格式 | `0 0 3 * * ?`（每天凌晨 3 点） |
| 输入参数 | JSON 格式，匹配脚本的 `inputSchema` | `{"mode": "full"}` |
| 启用 | 是否启用 | 是 |

### Cron 表达式参考（5 字段）

```
┌────────── 秒 (0-59)
│ ┌──────── 分 (0-59)
│ │ ┌────── 时 (0-23)
│ │ │ ┌──── 日 (1-31)
│ │ │ │ ┌── 月 (1-12)
│ │ │ │ │
* * * * *
```

| 场景 | 表达式 | 说明 |
|------|--------|------|
| 每分钟 | `* * * * *` | 每分钟执行一次 |
| 每 5 分钟 | `0 */5 * * *` | 每 5 分钟的 0 秒触发 |
| 每小时 | `0 0 * * *` | 整点触发 |
| 每天凌晨 3 点 | `0 0 3 * *` | 每天 03:00 |
| 工作日 9 点 | `0 0 9 * * 1-5` | 周一至周五 09:00 |
| 每月 1 号凌晨 | `0 0 0 1 *` | 每月 1 号 00:00 |

### 操作

- **启用/禁用**：切换定时任务状态
- **编辑**：修改 Cron 或输入参数
- **删除**：移除定时任务
- **最近执行结果**：查看该调度最近的执行记录

### REST API

```bash
# 列表
curl http://localhost:5177/api/schedules

# 详情
curl http://localhost:5177/api/schedules/{id}

# 创建
curl -X POST http://localhost:5177/api/schedules \
  -H 'Content-Type: application/json' \
  -d '{
    "scriptId": "data-cleanup",
    "name": "每日清理",
    "cronExpression": "0 0 3 * *",
    "input": {"mode": "full"},
    "enabled": true
  }'

# 更新
curl -X PUT http://localhost:5177/api/schedules/{id} \
  -H 'Content-Type: application/json' \
  -d '{...}'

# 删除
curl -X DELETE http://localhost:5177/api/schedules/{id}

# 启用/禁用
curl -X POST http://localhost:5177/api/schedules/{id}/enable
curl -X POST http://localhost:5177/api/schedules/{id}/disable
```

## 事件源

事件源（EventSource）定义外部系统如何将事件发送到 ActionDock。它只负责"怎么进来"，不绑定业务逻辑。

### 数据模型

```java
public class EventSourceDefinition {
    private String id;
    private String name;
    private String key;              // 业务键，如 crm.customer.created
    private boolean enabled;
    private String description;
    private EventSourceTransport transport;   // 传输方式
    private EventSourceAuthConfig auth;       // 鉴权配置
    private ProcessorDefinition normalizationProcessor; // 标准化处理器
    private Map<String, Object> sampleContext; // 测试样例
}

public class EventSourceAuthConfig {
    private EventSourceAuthMode mode;  // NONE / HEADER_TOKEN / QUERY_TOKEN / HMAC_SHA256
    private String token;              // TOKEN 值
    // HMAC 相关字段
    private String signatureHeader;
    private String signaturePrefix;
    private String signaturePayload;   // RAW_BODY
    private String timestampHeader;
    private Integer maxSkewSeconds;
    private String secretConfigKey;    // Config Value 中的 Key
}
```

### 创建事件源

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 人类可读名称 | `CRM 客户创建` |
| Key | 唯一业务键（建议稳定命名） | `crm.customer.created` |
| 传输方式 | 当前仅支持 `HTTP_WEBHOOK` | `HTTP_WEBHOOK` |
| Webhook 端点 | 系统自动生成 | `POST /api/event-sources/{id}/events` |
| 鉴权模式 | 鉴权方式 | 见下方 |
| 标准化处理器 | 将原始请求转为统一事件 | 见 Processor 类型 |
| 样例上下文 | 测试用的 Headers、Query、Body 样例 | |

### 鉴权模式

| 模式 | 说明 | 推荐场景 |
|------|------|----------|
| `NONE` | 无需鉴权 | 内部开发测试 |
| `HEADER_TOKEN` | 请求头携带 Token | 内部系统对接 |
| `QUERY_TOKEN` | URL 查询参数携带 Token | 简单 Webhook |
| `HMAC_SHA256` | HMAC 签名校验 | 公开 Webhook，安全性最高 |

**HMAC 推荐配置：**

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

### 标准化处理器

标准化处理器的目标是把外部请求转成统一事件格式。

**推荐的最小输出结构：**

```json
{
  "eventType": "customer.created",
  "eventId": "ext-123",
  "actor": "system",
  "subject": "customer-001",
  "timestamp": "2026-05-06T12:00:00Z"
}
```

**处理方法选择：**

| 模式 | 适用场景 |
|------|----------|
| `JSON_PATH` | 简单的字段提取映射 |
| `TEMPLATE` | 需要拼装结构的场景 |
| `SCRIPT_REF` | 复杂清洗、签名校验、条件变换 |

### 测试标准化

配置完成后，使用「测试标准化」功能：

1. 填入测试样例（Headers、Query、Body）
2. 系统调用标准化处理器
3. 展示标准化后的统一事件
4. 检查输出是否符合预期

### 外部系统调用 Webhook

外部系统向事件源发送事件的 HTTP 请求：

```bash
curl -X POST http://localhost:5177/api/event-sources/{sourceId}/events \
  -H 'Content-Type: application/json' \
  -H 'X-Token: your-token' \
  -d '{
    "id": "ext-123",
    "type": "customer.created",
    "data": {
      "name": "张三",
      "email": "zhangsan@example.com"
    }
  }'
```

注意：这个端点不需要 Bearer Token 认证（外部系统无法获取你的 Token），使用事件源自身的鉴权机制。

### REST API

```bash
# 事件源 CRUD
GET    /api/event-sources
POST   /api/event-sources
GET    /api/event-sources/{id}
PUT    /api/event-sources/{id}

# 测试标准化
POST   /api/event-sources/{id}/test-normalization

# 接收外部事件（不需要 Bearer Token）
POST   /api/event-sources/{id}/events
```

## 事件触发

事件触发（EventTrigger）定义"事件源来了事件后，怎么触发哪个脚本"。

### 数据模型

```java
public class EventTrigger {
    private String id;
    private String name;
    private String description;
    private boolean enabled;
    private String sourceId;           // 关联的事件源 ID
    private String targetScriptId;     // 目标脚本 ID（必须已发布）
    private ProcessorDefinition filterProcessor;     // 过滤处理器
    private ProcessorDefinition idempotencyProcessor; // 幂等处理器
    private ProcessorDefinition inputProcessor;       // 入参生成处理器
    private SubmitMode submitMode;     // SYNC / ASYNC
}
```

### 创建事件触发

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 人类可读名称 | `新客户→欢迎邮件` |
| 描述 | 触发器用途说明 | `客户创建后发送欢迎邮件` |
| 事件源 | 选择已配置的事件源 | `crm-customer-created` |
| 目标脚本 | 必须是已发布的脚本 | `send-welcome-email` |
| 过滤处理器 | 决定"要不要触发" | `{"matched": true}` |
| 幂等处理器 | 防止重复触发 | `{"key": "ext-123"}` |
| 输入处理器 | 生成目标脚本的入参 | 匹配 `inputSchema` |
| 提交模式 | 同步或异步 | `ASYNC`（推荐） |
| 启用 | 是否启用 | 是 |

### 处理器配置

详见 [事件框架配置指南](event-framework.md) 的「Processor 配置」章节。

**过滤处理器约定输出：**

```json
{ "matched": true }   // 触发
{ "matched": false }  // 跳过
```

**幂等处理器约定输出：**

```json
{ "key": "external-event-id-123" }
```

### 调试流程

1. **测试**：调用 `POST /api/event-triggers/{id}/test` 验证处理器输出，**不执行目标脚本**
2. **试运行**：创建一次真实的执行记录，验证完整链路
3. **查看事件记录**：确认分发记录和执行结果

### REST API

```bash
# 事件触发 CRUD
GET    /api/event-triggers
POST   /api/event-triggers
GET    /api/event-triggers/{id}
PUT    /api/event-triggers/{id}

# 测试（不执行目标脚本）
POST   /api/event-sources/{id}/test-filter

# 获取分发记录
GET    /api/event-sources/{id}/dispatches
```

## 事件记录

事件记录（EventRecord）保存了事件的完整链路信息，是排查问题的核心入口。

### 数据模型

```java
public class EventRecord {
    private String id;
    private String sourceId;     // 事件源
    private NormalizedEvent normalizedEvent;   // 标准化后的事件
    private EventRecordStatus status;          // 处理状态
    private LocalDateTime createdAt;
    // 原始请求
    private Map<String, Object> rawHeaders;
    private Map<String, Object> rawQuery;
    private String rawBody;
}
```

### 事件记录列表

| 列 | 说明 |
|----|------|
| 记录 ID | 事件记录标识（点击进入详情） |
| 事件源 | 来源事件源 |
| 标准事件 | 标准化后的事件摘要（eventId、eventType） |
| 状态 | 处理状态 |
| 时间戳 | 事件接收时间 |

### 事件记录详情

点进一条记录后，可以看到：

1. **原始请求**：Headers、Query、Body
2. **标准化事件**：处理器输出结果
3. **分发记录**：哪些触发器命中、执行结果、错误信息

### 分发记录（EventDispatchRecord）

```java
public class EventDispatchRecord {
    private String id;
    private String eventRecordId;
    private String triggerId;
    private String executionId;     // 关联的执行记录
    private EventDispatchStatus status;  // PENDING / SUCCESS / FAILED / SKIPPED / FILTERED / DUPLICATE
    private String errorMessage;
    private LocalDateTime createdAt;
}
```

分发状态说明：

| 状态 | 含义 |
|------|------|
| `PENDING` | 待分发 |
| `SUCCESS` | 已成功触发脚本执行 |
| `FAILED` | 触发失败 |
| `SKIPPED` | 跳过（未配置触发器） |
| `FILTERED` | 被过滤处理器拦截（`matched: false`） |
| `DUPLICATE` | 被幂等处理器判定为重复事件 |

### REST API

```bash
GET /api/event-records                  # 事件记录列表
GET /api/event-records/{id}             # 事件记录详情
GET /api/event-records/{id}/dispatches  # 关联的分发记录
```

## 处理器类型

详见 [事件框架配置指南](event-framework.md) 的详细配置，这里列出三种类型总览：

| 模式 | 适用场景 | 配置示例 |
|------|----------|----------|
| `JSON_PATH` | 从事件中提取字段 | `{"mode":"JSON_PATH","jsonPath":{"fields":{"name":"$.body.name"}}}` |
| `TEMPLATE` | 拼装输出结构 | `{"mode":"TEMPLATE","template":{"engine":"MUSTACHE","template":{"subject":"{{body.name}}"}}}` |
| `SCRIPT_REF` | 复杂转换逻辑 | `{"mode":"SCRIPT_REF","scriptRef":{"scriptId":"my-processor"}}` |

## 常见问题

### Q: 定时任务没有触发

1. 检查是否已启用
2. 检查目标脚本是否已发布
3. 检查 Cron 表达式是否正确
4. 查看执行历史是否有记录

### Q: 事件没有进来

1. 检查 Webhook 地址是否正确（`POST /api/event-sources/{sourceId}/events`）
2. 检查鉴权配置是否匹配外部系统发送的 Header/Query
3. 外部系统发送的是否为 JSON 格式
4. 查看事件记录中是否有该事件的原始请求

### Q: 触发器不命中

在事件记录中查看分发状态：
- 如果是 `FILTERED`，检查过滤处理器的 `matched` 输出
- 如果是 `DUPLICATE`，检查幂等处理器的 `key`

### Q: 保存事件触发时报"目标脚本未发布"

说明 `targetScriptId` 指向的脚本还不是 `PUBLISHED` 状态。先发布脚本（`POST /api/scripts/{id}/publish`），再保存触发器。

### Q: 试运行报 Schema 校验失败

说明 Input Processor 的输出和目标脚本 `inputSchema` 不匹配。先修正输入处理器，再试运行。

## 最佳实践

- **事件源只做接入**：事件源只负责鉴权和标准化，不要把业务分支写死在这里
- **触发器只做路由**：事件触发只做过滤、幂等和入参生成，不要混入过重的业务逻辑
- **复杂变换用 SCRIPT_REF**：超过 3 个字段的映射或用条件逻辑，优先用 `SCRIPT_REF`
- **幂等 key 要稳定**：使用外部事件 ID 或业务主键组合，确保能唯一标识一个外部事件
- **先用测试面板**：正式接流量前，先通过测试面板验证处理器输出
- **优先使用 ASYNC**：事件驱动场景大部分适合异步，避免阻塞外部系统

---

> [返回目录](user-manual.md) | 下一步：了解 [系统设置](system-settings.md)
