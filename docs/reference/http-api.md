# HTTP API 接口契约

ActionDock 2.x 微服务模式（通过 `ad serve` 启动）提供标准 RESTful API 规范，用于向远程 AI 智能体、持续集成流水线、网关及外部业务系统提供能力自省、动作调度与任务流管理。

---

## 协议约定与鉴权模型

### 路由前缀

- 标准 API 根路由：统一采用 `/api/v2` 前缀（例如 `GET /api/v2/actions`、`POST /api/v2/actions/:id/run`）。
- 虚拟投影视图命名空间路由：统一采用 `/views/:viewName/api/v2/*` 前缀（例如 `GET /views/:viewName/api/v2/actions`、`POST /views/:viewName/api/v2/actions/:id/run`、`GET /views/:viewName/api/v2/config`）。
  - 视图端点隔离：请求带有 `/views/:viewName` 前缀的端点时，服务端自动激活该指定视图的安全策略（包括该视图独立的 Bearer 令牌、包白名单、动作白名单与管理权限开关）。
  - 视图专属 MCP 协议端点：挂载在 `/views/:viewName/mcp` 路径下，各视图的工具集合与调用权限严格限定在该视图权限范围内。
  - 子路径规范化防穿透：服务端在解析视图请求时，对 `:viewName` 之后的子路径执行规范化解析，自动消除多斜杠并解析相对路径跳转，防范命名空间混淆与目录穿透。
  - 视图未找到拦截：若请求的 `:viewName` 未在服务端注册，直接返回 HTTP 404 状态码与 `NOT_FOUND` 错误。
- 根路径向后兼容与智能视图匹配：
  - 传统根路径路由（如 `/health`、`/doctor`、`/info`、`/packages`、`/actions`、`/runs`、`/playbooks`）自动映射至对等的 `/api/v2/*` 端点，既有调用无需修改路径。
  - 智能令牌视图匹配：当客户端直接请求根路径路由（`/api/v2/*` 或 `/mcp`）时，服务端提取请求中的 Bearer 令牌并遍历已注册视图；若命中匹配，自动激活该视图对应的安全策略。若未提供令牌或未命中任何自定义视图，则平滑回退至默认视图策略。

### 身份鉴权机制

服务端监听在非回环地址（如 `0.0.0.0` 或物理网卡 IP）时，强制要求配置鉴权令牌（通过启动参数 `--token`、环境变量 `ACTIONDOCK_TOKEN` 或视图独立配置中的 `token` 注入）。所有受保护端点支持以下认证方式：

- **HTTP 请求头鉴权（标准推荐方式）**：
  ```text
  Authorization: Bearer <token>
  ```
- **URL 查询参数鉴权（受控可选方式）**：
  ```text
  ?token=<token>
  ```
  > [!IMPORTANT]
  > **安全策略提示**：出于安全防御考量（防范 Token 泄露至浏览器历史、服务端访问日志及 Referer 引用头），URL 查询参数鉴权**默认处于关闭状态**。仅当服务端启动时显式开启 `--allow-query-token` 开关时，服务端才允许解析 URL 查询参数中的 Token。生产环境强烈建议仅使用请求头鉴权。

- **虚拟投影视图独立令牌**：在单端口多视图服务中，每个虚拟视图可声明独立的鉴权令牌。当访问 `/views/:viewName/...` 命名空间端点时，必须提供与该视图相匹配的 Bearer 令牌；访问根路径端点时，服务端通过常数时间比对自动识别令牌归属的视图。
- **防时序侧信道攻击**：令牌校验底层采用 Node.js 原生的常数时间比对算法（`crypto.timingSafeEqual`），遍历全部已注册视图执行比对，彻底防范时序侧信道嗅探。
- **未授权拦截**：当配置了令牌且客户端未提供有效凭据时，服务端一律拒绝请求并返回 HTTP 401 状态码与 `UNAUTHORIZED` 错误。

### HTTP 状态码映射标准

| HTTP 状态码 | 含义与产生场景 | 对应错误码 |
| :--- | :--- | :--- |
| `200 OK` | 同步操作执行成功，返回结果数据 | - |
| `202 Accepted` | 异步任务已接受并在后台启动执行，返回任务票据与事件流地址 | - |
| `400 Bad Request` | 请求体 JSON 格式非法、输入参数校验失败或不可操作状态 | `INVALID_JSON`, `INPUT_VALIDATION_FAILED` |
| `401 Unauthorized` | 缺少鉴权令牌或令牌比对未通过 | `UNAUTHORIZED` |
| `403 Forbidden` | 目标包或动作未列入允许白名单，或未开启管理功能端点 | `PACKAGE_NOT_ALLOWED`, `ACTION_FORBIDDEN`, `PACKAGE_FORBIDDEN`, `CAPABILITY_UNAVAILABLE` |
| `404 Not Found` | 请求的 Action、Package、Playbook、Run 记录或指定虚拟视图不存在 | `ACTION_NOT_FOUND`, `PACKAGE_NOT_FOUND`, `PLAYBOOK_NOT_FOUND`, `RUN_NOT_FOUND`, `NOT_FOUND` |
| `409 Conflict` | 携带相同幂等标识发起了冲突请求，或取消已处终态的任务 | `IDEMPOTENCY_CONFLICT`, `RUN_ALREADY_FINISHED` |
| `410 Gone` | SSE 事件流断点续传游标在服务端已过期清理 | `EVENT_CURSOR_EXPIRED` |
| `413 Payload Too Large` | 请求体体积超过服务端配置的安全上限（默认 1MB） | `REQUEST_TOO_LARGE` |
| `504 Gateway Timeout` | Action 执行超时，超过了配置或请求指定的时限 | `ACTION_TIMEOUT` |
| `500 Internal Server Error` | Action 内部抛出未捕获异常或服务端底层故障 | `ACTION_EXECUTION_ERROR`, `ACTION_START_FAILED` |

---

## 系统与运维端点

### 系统健康探针 (`GET /api/v2/health`)

用于容器健康检测、Kubernetes 就绪探针与负载均衡存活探查：

- 请求方式：`GET`
- 鉴权说明：若服务端配置了鉴权令牌，访问本端点同样需要通过鉴权校验；未配置令牌时可公开访问。
- 响应状态码：200
- 响应数据结构：
  ```json
  {
    "ok": true,
    "status": "healthy",
    "version": "2.8.0",
    "timestamp": "2026-09-12T10:00:00.000Z",
    "uptime": 3600.5
  }
  ```
  （若服务端启动时开启了 `--expose-debug-info`，响应中会额外包含 `projectRoot` 字段）。

### 环境体检诊断 (`GET /api/v2/doctor`)

获取服务端所在宿主环境的体检诊断报告：

- 请求方式：`GET`
- 鉴权说明：需要有效 Bearer 令牌。
- 查询参数：
  - `package` 或 `packageId`（可选）：指定针对特定 Action Package 执行体检。
- 响应状态码：200
- 响应数据结构：
  ```json
  {
    "ok": true,
    "report": {
      "cwd": "/workspace/my-project",
      "healthy": true,
      "checks": [
        { "name": "sqlite_driver", "status": "pass" },
        { "name": "process_execution", "status": "pass" }
      ]
    }
  }
  ```

---

## 能力自省端点

### 全局能力大纲自省 (`GET /api/v2/info`)

返回当前服务加载的 Package、Action 与规程摘要：

- 请求方式：`GET`
- 鉴权说明：需要有效 Bearer 令牌。
- 查询参数：
  - `intent`（可选）：按自然语言意图或关键词过滤相关能力。
  - `package` 或 `packageId`（可选）：下钻查看指定包的完整详情。
  - `tree=true`（可选）：返回工作区层级树结构。
- 响应数据结构（平铺于顶层，非嵌套于 `data` 下）：
  - 默认多包列表形态（`type: "package_list"`）：
    ```json
    {
      "ok": true,
      "type": "package_list",
      "version": "2.8.0",
      "packages": [
        {
          "id": "example-tools",
          "name": "example-tools",
          "version": "1.0.0",
          "description": "Example Tools Package"
        }
      ]
    }
    ```
  - 单包或指定包详情形态（`type: "package_detail"`）：
    ```json
    {
      "ok": true,
      "type": "package_detail",
      "id": "example-tools",
      "name": "example-tools",
      "version": "1.0.0",
      "description": "Example Tools Package",
      "actions": [
        {
          "id": "sample.greet",
          "description": "输出打招呼问候语"
        }
      ],
      "playbooks": []
    }
    ```
  - 树形图谱形态（`type: "tree"`）：
    ```json
    {
      "ok": true,
      "type": "tree",
      "packages": [...]
    }
    ```

### 已加载包清单 (`GET /api/v2/packages`)

列出当前服务端已加载的所有 Action Package 清单：

- 请求方式：`GET`
- 鉴权说明：需要有效 Bearer 令牌。
- 查询参数：
  - `package` 或 `packageId`（可选）：仅返回匹配的指定包。
- 响应数据结构：
  ```json
  {
    "ok": true,
    "packages": [
      {
        "id": "example-tools",
        "name": "example-tools",
        "version": "1.0.0",
        "description": "Example Tools Package"
      }
    ]
  }
  ```

---

## Action 契约与执行调度

### Action 发现与契约调阅

#### 列出所有可用 Action (`GET /api/v2/actions`)
- 请求方式：`GET`
- 鉴权说明：需要有效 Bearer 令牌。
- 查询参数：
  - `intent` 或 `query`（可选）：意图模糊检索。
  - `package` 或 `packageId`（可选）：按所属包筛选。
  - `prefix`（可选）：按 Action 标识前缀筛选。
  - `tag`（可选，可重复）：按标注标签筛选。
- 白名单过滤：若服务端配置了 `-P, --package` 或 `-A, --action` 白名单，列表中仅返回同时满足白名单条件的 Action。
- 响应结构：直接返回 Action 规范对象数组：
  ```json
  [
    {
      "id": "sample.greet",
      "packageId": "example-tools",
      "description": "输出打招呼问候语",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        }
      }
    }
  ]
  ```

#### 查询特定 Action 契约模式
- 请求端点：
  - 简短模式：`GET /api/v2/actions/:actionId`
  - 多包模式：`GET /api/v2/packages/:packageId/actions/:actionId`
- 响应结构：直接返回单个 `ActionSpec` 规范对象（结构同数组单项）。若 Action 不存在则返回 404 与 `ACTION_NOT_FOUND`；若服务端配置了 `-P, --package` 且目标包未在白名单中，返回 403 与 `PACKAGE_NOT_ALLOWED`；若服务端配置了 `-A, --action` 且目标动作未在白名单中，返回 403 与 `ACTION_FORBIDDEN`。

---

### Action 执行调度

#### 同步阻塞执行 (`POST /api/v2/actions/:actionId/run`)

直接同步执行目标 Action，等待其运行结束并返回最终结果信封：

- 请求端点：
  - 简短模式：`POST /api/v2/actions/:actionId/run`
  - 多包模式：`POST /api/v2/packages/:packageId/actions/:actionId/run`
- 白名单约束：若服务端启动时配置了 `-P, --package` 包白名单或 `-A, --action` 动作白名单，请求未列入白名单的包或动作将被服务端阻断拦截，分别返回 HTTP 403 状态码与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。同时配置时需同时满足两项白名单约束。
- 请求头支持：
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
  - `Idempotency-Key` 或 `X-Request-Id`（可选）：指定幂等请求标识，防范网络重发导致的重复执行。
- 请求体：
  ```json
  {
    "input": {
      "name": "ActionDock"
    },
    "config": {
      "CUSTOM_FLAG": "value"
    },
    "execution": {
      "timeoutMs": 10000
    }
  }
  ```
- 响应状态码与响应体：
  - 执行成功（200 OK）：
    ```json
    {
      "ok": true,
      "runId": "01JMB394...",
      "data": {
        "message": "Hello, ActionDock!"
      }
    }
    ```
  - 输入参数校验失败（400 Bad Request）：
    ```json
    {
      "ok": false,
      "runId": "01JMB394...",
      "error": {
        "code": "INPUT_VALIDATION_FAILED",
        "message": "Input validation failed for action 'sample.greet'",
        "details": [
          { "path": "/name", "message": "is required" }
        ]
      }
    }
    ```
  - 幂等冲突（409 Conflict）：携带相同 `Idempotency-Key` 但传入了不同的 `input` 时返回 `IDEMPOTENCY_CONFLICT`。
  - 执行超时（504 Gateway Timeout）：超过指定 `timeoutMs` 时返回 `ACTION_TIMEOUT`。

#### 异步启动执行 (`POST /api/v2/actions/:actionId/start`)

针对耗时较长的后台任务，服务端立即登记执行票据并返回 202 Accepted：

- 请求端点：
  - 简短模式：`POST /api/v2/actions/:actionId/start`
  - 多包模式：`POST /api/v2/packages/:packageId/actions/:actionId/start`
- 请求体与请求头参数与同步模式完全一致。
- 白名单约束：与同步模式一致，未列入白名单的包或动作将被服务端阻断拦截，分别返回 403 与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。
- 响应状态码：202 Accepted
- 响应数据结构：
  ```json
  {
    "ok": true,
    "runId": "01JMB394XYZ...",
    "status": "running",
    "streamUrl": "/api/v2/runs/01JMB394XYZ.../events"
  }
  ```

---

## 运行历史、取消与事件流端点

### 查询执行历史记录 (`GET /api/v2/runs`)

- 请求方式：`GET`
- 鉴权说明：需要有效 Bearer 令牌。
- 白名单过滤：若服务端配置了包白名单或动作白名单，返回的历史记录列表自动过滤，仅包含符合白名单条件的记录。
- 查询参数：
  - `limit`（可选）：最大返回记录数，**默认值为 50**。
  - `status`（可选）：按运行状态筛选。状态包含进行中状态（`pending`、`running`）以及终态（`success`、`failed`、`cancelled`、`timed_out`、`interrupted`）。
  - `actionId`（可选）：按动作标识筛选。
  - `packageId`（可选）：按包标识筛选。
  - `intent`（可选）：按关键词意图筛选。
- 响应数据结构：
  ```json
  {
    "ok": true,
    "total": 1,
    "items": [
      {
        "id": "01JMB394XYZ...",
        "actionId": "sample.greet",
        "packageId": "example-tools",
        "status": "success",
        "startedAt": "2026-09-12T10:00:00.000Z",
        "finishedAt": "2026-09-12T10:00:00.050Z",
        "input": { "name": "ActionDock" },
        "output": { "message": "Hello, ActionDock!" }
      }
    ]
  }
  ```

### 查询单次执行详情 (`GET /api/v2/runs/:runId`)

- 请求方式：`GET`
- 响应结构：直接返回单个 `RunRecord` 实体对象。若任务不存在返回 404 与 `RUN_NOT_FOUND`；若任务所属包或动作未在允许白名单中，返回 403 与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。

### 取消正在执行的任务 (`POST /api/v2/runs/:runId/cancel`)

向指定任务广播取消信号并回收受管子进程树：

- 请求方式：`POST`
- 请求体（可选）：
  ```json
  {
    "reason": "用户主动取消操作"
  }
  ```
- 响应状态码与响应体：
  - 成功发送取消信号（200 OK）：
    ```json
    {
      "ok": true,
      "runId": "01JMB394XYZ...",
      "status": "cancelled"
    }
    ```
  - 任务已处于终态（409 Conflict）：
    ```json
    {
      "ok": false,
      "error": {
        "code": "RUN_ALREADY_FINISHED",
        "message": "Run '01JMB394XYZ...' has already finished with status 'success'",
        "status": "success"
      }
    }
    ```
  - 任务未列入白名单（403 Forbidden）：若任务所属包或动作未在允许白名单中，返回 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。
  - 任务未找到（404 Not Found）：返回 `RUN_NOT_FOUND`。

### 清理执行历史记录 (`POST /api/v2/runs/clear` 或 `DELETE /api/v2/runs`)

批量清理历史执行记录：

- 请求参数（支持查询参数或 JSON 请求体）：`packageId`、`actionId`、`status`
- 响应：
  ```json
  {
    "ok": true,
    "clearedCount": 12
  }
  ```

### 订阅实时事件流 (`GET /api/v2/runs/:runId/events`)

采用标准 Server-Sent Events（SSE）协议向客户端推送实时日志与状态流：

- 请求方式：`GET`
- 响应头：`Content-Type: text/event-stream`
- 白名单校验：若任务所属包或动作未在允许白名单中，服务端拒绝推送并返回 HTTP 403 状态码与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。
- 断点续传支持：
  - 客户端可在请求头携带 `Last-Event-ID: <eventId>`，或在 URL 中添加 `?after=<eventId>`。
  - 服务端从指定游标之后恢复推送。
  - 若游标在服务端已过期清理，服务端返回 HTTP 410 Gone 与错误码 `EVENT_CURSOR_EXPIRED`。
- 背压控制：
  - 若客户端消费速度过慢导致内部事件队列积压超限，服务端推送包含 `EVENT_BACKPRESSURE_LIMIT` 错误码的终止事件并关闭连接，防止服务端内存溢出。

---

## Playbook 规程端点

### 查询规程清单 (`GET /api/v2/playbooks`)

- 请求方式：`GET`
- 查询参数：`intent`、`package` / `packageId`
- 响应结构：直接返回规程摘要对象数组 `PlaybookSummary[]`。

### 查询规程详情

- 请求端点：
  - 简短模式：`GET /api/v2/playbooks/:id`
  - 多包模式：`GET /api/v2/packages/:packageId/playbooks/:playbookId`
- 响应结构：返回规程定义对象（包含 `id`, `name`, `description`, `filePath`, `actions` 等）。未找到时返回 404 与 `PLAYBOOK_NOT_FOUND`。

---

## 管理类端点（配置与持久化状态）

> [!IMPORTANT]
> **管理接口开启门禁**：所有 `/api/v2/config` 与 `/api/v2/state` 管理路由默认处于禁用状态。必须在服务端启动时显式传入 `--management` 参数，或在对应虚拟视图配置中设置 `enableManagement: true`，否则服务端统一返回 HTTP 403 Forbidden 与 `CAPABILITY_UNAVAILABLE` 错误。

### 环境变量满足度体检 (`GET /api/v2/config/env`)

检查当前包在宿主操作系统环境变量中所需配置的满足情况：

- 请求方式：`GET`
- 查询参数：`package` 或 `packageId`（可选）
- 响应数据示例：
  ```json
  {
    "ok": true,
    "packageId": "example-tools",
    "envChecks": [
      {
        "key": "GITHUB_TOKEN",
        "required": true,
        "satisfied": true,
        "matchedEnv": "GITHUB_TOKEN",
        "hasDefault": false,
        "secret": true
      }
    ]
  }
  ```

### 状态键列表查询 (`GET /api/v2/state`)

- 请求方式：`GET`
- 查询参数：`package`、`action`、`namespace`、`prefix`
- 响应数据结构：
  ```json
  {
    "ok": true,
    "packageId": "example-tools",
    "keys": ["user_pref", "cache_stamp"]
  }
  ```

---

## 模型上下文协议网关端点

ActionDock 服务端内嵌支持标准 MCP 协议端点，便于 AI 智能体通过网络直接发现并调度工具能力：

### 统一根 MCP 端点 (`POST /mcp`)

- 请求方式：`POST`（支持 Streamable HTTP 与 SSE 通信）
- 鉴权说明：需携带当前生效的 Bearer 令牌。
- 策略约束：继承全局策略或基于令牌自动匹配的视图策略，`tools/list` 仅返回白名单内的工具，`tools/call` 严格实施白名单校验。

### 虚拟视图专属 MCP 端点 (`POST /views/:viewName/mcp`)

- 请求方式：`POST`（支持 Streamable HTTP 与 SSE 通信）
- 鉴权说明：需携带与 `:viewName` 视图匹配的 Bearer 令牌。
- 策略约束：严格限定在该视图的 `packageAllowlist` 与 `actionAllowlist` 范围内。
- 视图禁用状态：若目标视图配置了 `enableMcp: false`，服务端拒绝连接并返回 HTTP 404 状态码与 `NOT_FOUND` 错误。
