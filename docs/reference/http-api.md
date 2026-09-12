# HTTP API 接口契约

ActionDock 微服务模式（通过 `ad serve` 启动）暴露标准 RESTful API 规范，用于向远程 AI 智能体、持续集成流水线、网关及外部业务系统提供能力自省与动作调度。

---

## 协议约定与鉴权模型

### 路由前缀

- 标准 API 路由采用 `/api/v2` 前缀。
- 为兼容早期客户端，根路径路由（如 `/health`、`/info`、`/actions`）自动映射至对等的 `/api/v2/*` 端点。

### 鉴权机制

服务端监听在非回环地址（如 `0.0.0.0` 或物理网卡 IP）时，强制启用令牌鉴权。所有受保护的端点支持以下认证方式：

- 请求头鉴权（推荐）：`Authorization: Bearer <token>`
- 查询参数鉴权：`?token=<token>`

未提供有效凭据时，服务端返回 401 状态码与 `UNAUTHORIZED` 错误；校验过程采用常数时间算法，彻底防范时序侧信道攻击。

### 通用响应信封

所有业务接口均统一返回标准 JSON 响应信封：

成功响应示例：
```json
{
  "ok": true,
  "runId": "01JMBD6V...",
  "data": {
    "result": "success"
  }
}
```

失败响应示例：
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "输入参数校验未通过",
    "details": [
      {
        "path": "/repo",
        "message": "必须为合法的仓库路径格式"
      }
    ]
  }
}
```

### HTTP 状态码映射

- `200 OK`：同步操作执行成功，返回终态数据。
- `202 Accepted`：异步任务已接受并在后台启动执行。
- `400 Bad Request`：请求体格式不正确或 JSON 解析失败。
- `401 Unauthorized`：缺少鉴权令牌或令牌校验未通过。
- `403 Forbidden`：访问了受安全策略限制的端点。
- `404 Not Found`：请求的 Action、Playbook 或 Run 记录不存在。
- `410 Gone`：SSE 事件流游标已过期被清理，无法继续断点续传。
- `413 Payload Too Large`：请求体体积超过服务端配置的安全上限。
- `422 Unprocessable Entity`：输入参数未通过模式契约校验。
- `500 Internal Server Error`：Action 执行异常或服务端内部错误。

---

## 系统与运维端点

### 健康探针 (`GET /api/v2/health`)

用于容器健康检测与负载均衡存活探查（免鉴权）：

- 请求方式：`GET`
- 鉴权要求：无需鉴权
- 响应数据：
  ```json
  {
    "status": "ok",
    "version": "2.1.0",
    "timestamp": "2026-09-12T10:00:00.000Z",
    "uptime": 3600.5
  }
  ```

### 环境体检诊断 (`GET /api/v2/doctor`)

获取服务端所在主机的运行时环境体检报告：

- 请求方式：`GET`
- 鉴权要求：需要鉴权
- 响应数据：
  ```json
  {
    "ok": true,
    "data": {
      "nodeVersion": "v24.12.0",
      "sqlite": "native",
      "dataDir": "/root/.actiondock/data",
      "healthy": true,
      "checks": [
        { "name": "sqlite_storage", "status": "pass" },
        { "name": "process_isolation", "status": "pass" }
      ]
    }
  }
  ```

---

## 能力自省端点

### 全局能力自省 (`GET /api/v2/info`)

返回当前服务加载的全部包、Action 与规程摘要信息：

- 请求方式：`GET`
- 鉴权要求：需要鉴权
- 查询参数：
  - `intent`（可选）：按自然语言意图或关键词过滤能力。
- 响应数据：
  ```json
  {
    "ok": true,
    "data": {
      "packages": [
        {
          "name": "example-tools",
          "version": "1.0.0",
          "actionsCount": 2,
          "playbooksCount": 1
        }
      ],
      "actions": [
        {
          "id": "sample.greet",
          "description": "输出打招呼问候语"
        }
      ]
    }
  }
  ```

### 包清单查询 (`GET /api/v2/packages`)

列出已加载的全部 Action Package 基础信息：

- 请求方式：`GET`
- 鉴权要求：需要鉴权
- 响应包含包名称、版本、依赖拓扑与能力统计。

---

## Action 契约与执行端点

### Action 清单与详情

#### 列出所有可用 Action (`GET /api/v2/actions`)
- 请求方式：`GET`
- 鉴权要求：需要鉴权
- 返回 Action 列表及其摘要说明。

#### 查询特定 Action 模式规范 (`GET /api/v2/actions/:actionId`)
- 请求方式：`GET`
- 路径参数：`actionId`（Action 标识）
- 鉴权要求：需要鉴权
- 响应包含输入参数 JSON Schema、输出模式、关联配置需求与依赖说明。

#### 多包环境下查询 Action (`GET /api/v2/packages/:packageId/actions/:actionId`)
- 请求方式：`GET`
- 路径参数：`packageId`（所属包名）、`actionId`（Action 标识）
- 鉴权要求：需要鉴权

### Action 执行调度

#### 同步阻塞执行 (`POST /api/v2/actions/:actionId/run`)

直接执行目标 Action，等待其运行结束并返回最终结果信封：

- 请求方式：`POST`
- 路径参数：`actionId`（Action 标识）
- 请求体：
  ```json
  {
    "input": {
      "name": "ActionDock"
    },
    "config": {
      "CUSTOM_OPT": "temp-value"
    }
  }
  ```
- 响应状态码：
  - 成功返回 `200 OK`
  - 参数不合法返回 `422 Unprocessable Entity`
  - 执行崩溃或异常返回 `500 Internal Server Error`

#### 多包模式同步执行 (`POST /api/v2/packages/:packageId/actions/:actionId/run`)
- 请求方式：`POST`
- 路径参数：`packageId`（包名）、`actionId`（Action 标识）
- 请求体与响应结构同上。

#### 异步启动执行 (`POST /api/v2/actions/:actionId/start`)

针对长耗时任务，服务端立即分配执行标识并后台调度：

- 请求方式：`POST`
- 响应状态码：`202 Accepted`
- 响应数据：
  ```json
  {
    "ok": true,
    "runId": "01JMB6XYZ...",
    "streamUrl": "/api/v2/runs/01JMB6XYZ.../events"
  }
  ```

#### 多包模式异步启动 (`POST /api/v2/packages/:packageId/actions/:actionId/start`)
- 请求方式：`POST`
- 路径参数：`packageId`（包名）、`actionId`（Action 标识）
- 请求体与响应结构同上。

---

## 运行历史、取消与事件流端点

### 查询执行历史记录 (`GET /api/v2/runs`)

- 请求方式：`GET`
- 鉴权要求：需要鉴权
- 查询参数：
  - `actionId`（可选）：按动作标识筛选。
  - `status`（可选）：按终态筛选，可选 `completed`、`failed`、`cancelled`、`running`。
  - `limit`（可选）：最大返回数量，默认 20。

### 查询单次执行详情 (`GET /api/v2/runs/:runId`)

- 请求方式：`GET`
- 路径参数：`runId`（执行唯一标识）
- 鉴权要求：需要鉴权
- 返回执行当前状态、耗时、开始/结束时间戳与最终输出或错误详情。

### 取消正在执行的任务 (`POST /api/v2/runs/:runId/cancel`)

向正在运行的 Action 传播取消信号（底层触发 `AbortController` 并终止派生的受管子进程树）：

- 请求方式：`POST`
- 路径参数：`runId`（执行唯一标识）
- 请求体：
  ```json
  {
    "reason": "用户主动取消操作"
  }
  ```
- 响应数据：
  ```json
  {
    "ok": true,
    "runId": "01JMB6XYZ...",
    "status": "cancelled"
  }
  ```

### 订阅实时事件流 (`GET /api/v2/runs/:runId/events`)

采用标准 Server-Sent Events（SSE）协议向客户端持续推送执行过程中的日志、进度与状态变更：

- 请求方式：`GET`
- 响应头：`Content-Type: text/event-stream`
- 鉴权要求：支持请求头或 `?token=<token>` 查询参数。
- 断点续传：支持在请求头携带 `Last-Event-ID`，服务端从该事件序号之后恢复推送。
- 异常场景响应：
  - 游标已失效被清理：返回状态码 `410 Gone` 与错误码 `EVENT_CURSOR_EXPIRED`。
  - 客户端消费过慢背压堆积超限：推送携带 `EVENT_BACKPRESSURE_LIMIT` 错误码的终止事件并关闭连接。

---

## Playbook 规程端点

### 查询规程清单 (`GET /api/v2/playbooks`)

- 请求方式：`GET`
- 鉴权要求：需要鉴权
- 返回当前加载的所有 Playbook 规程标识、标题与关联 Action 列表。

### 查询规程详情 (`GET /api/v2/playbooks/:playbookId`)

- 请求方式：`GET`
- 路径参数：`playbookId`（规程标识）
- 鉴权要求：需要鉴权
- 返回规程 Markdown 原始内容、时序说明与关联参数。

---

## 错误代码速查表

| 错误代码 | HTTP 状态码 | 含义与产生原因 | 建议处理方式 |
| :--- | :--- | :--- | :--- |
| `UNAUTHORIZED` | 401 | 缺少鉴权令牌或令牌比对未通过 | 检查并注入正确的 Bearer Token 凭证 |
| `FORBIDDEN` | 403 | 访问了受保护的安全端点或 IP 未获授权 | 检查服务端安全配置与访问策略 |
| `INVALID_INPUT` | 422 | 输入参数不符合 Action 声明的模式规范 | 调阅 Action 模式契约并修正传参 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体超过配置的大小限制（默认 1MB） | 拆分批次或通过 `--max-body` 调整阈值 |
| `ACTION_NOT_FOUND` | 404 | 请求的 Action 标识不存在 | 调用 `/api/v2/actions` 核对可用列表 |
| `PACKAGE_NOT_FOUND` | 404 | 请求的 Package 标识不存在 | 调用 `/api/v2/packages` 核对可用列表 |
| `RUN_NOT_FOUND` | 404 | 查询的 Run 记录标识不存在 | 检查任务标识是否有效 |
| `RUN_NOT_CANCELABLE` | 400 | 任务已处于终态，无法再次执行取消 | 无需处理，任务已结束 |
| `EVENT_CURSOR_EXPIRED` | 410 | SSE 断点续传游标在服务端已过期清理 | 重新拉取完整执行详情而非继续追溯事件 |
| `EVENT_BACKPRESSURE_LIMIT` | 500 | 客户端消费事件速度过慢触发服务端防爆保护 | 提升客户端网络读取效率 |
| `INTERNAL_ERROR` | 500 | Action 内部抛出未捕获异常或运行时故障 | 查看服务端日志或错误信封中的堆栈信息 |
