# 触发中心

## 一句话理解

触发中心管理所有"自动执行"的方式：定时任务（Cron）和事件驱动（Webhook）。定时任务让脚本按时间计划自动运行；事件驱动让外部系统通过 Webhook 发送事件，经过过滤、幂等处理后触发脚本执行。

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

## 事件驱动

事件驱动能力（事件源、事件触发、事件记录、处理器）由事件框架提供。

### 事件源

事件源定义外部系统如何将事件发送到 ActionDock。它只负责"怎么进来"，不绑定业务逻辑。

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 人类可读名称 | `CRM 客户创建` |
| Key | 唯一业务键 | `crm.customer.created` |
| 传输方式 | 当前仅支持 `HTTP_WEBHOOK` | `HTTP_WEBHOOK` |
| Webhook 端点 | 系统自动生成 | `POST /api/event-sources/{id}/events` |
| 鉴权模式 | `NONE` / `HEADER_TOKEN` / `QUERY_TOKEN` / `HMAC_SHA256` | 见事件框架配置指南 |
| 标准化处理器 | 将原始请求转为统一事件 | 见事件框架配置指南 |

### 事件触发

事件触发定义"事件源来了事件后，怎么触发哪个脚本"。

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 人类可读名称 | `新客户→欢迎邮件` |
| 事件源 | 选择已配置的事件源 | `crm-customer-created` |
| 目标脚本 | 必须是已发布的脚本 | `send-welcome-email` |
| 过滤处理器 | 决定"要不要触发" | `{"matched": true}` |
| 幂等处理器 | 防止重复触发 | `{"key": "ext-123"}` |
| 输入处理器 | 生成目标脚本的入参 | 匹配 `inputSchema` |
| 提交模式 | 同步或异步 | `ASYNC`（推荐） |

### 事件记录

事件记录保存了事件的完整链路信息，是排查问题的核心入口。

点进一条记录后，可以看到：

1. **原始请求**：Headers、Query、Body
2. **标准化事件**：处理器输出结果
3. **分发记录**：哪些触发器命中、执行结果、错误信息

> 事件框架的架构、配置方法、处理器详解、鉴权模式、REST API 和完整示例请参考 [事件框架配置指南](event-framework.md)。

## 常见问题

### Q: 定时任务没有触发

1. 检查是否已启用
2. 检查目标脚本是否已发布
3. 检查 Cron 表达式是否正确
4. 查看执行历史是否有记录

### Q: 事件相关问题

> 事件框架的常见问题和排查方法请参考 [事件框架配置指南](event-framework.md)。

---

> [返回目录](user-manual.md) | 下一步：了解 [系统设置](system-settings.md)
