# HTTP API 接口契约

ActionDock 微服务模式通过 `ad serve` 启动。该模式提供 RESTful API，用于能力自省、动作调度与任务管理。

---

## 协议约定与鉴权模型

### 路由前缀

- 标准 API 根路由：统一采用 `/api/v2` 前缀。例如 `GET /api/v2/actions`。
- 虚拟投影视图命名空间路由：统一采用 `/views/:viewName/api/v2/*` 前缀。
  - 视图端点隔离：带有前缀的端点激活指定视图的安全策略。策略包含独立令牌、白名单与管理权限。
  - 视图专属 MCP 协议端点：挂载在 `/views/:viewName/mcp` 路径下。工具集合限定在视图权限内。
  - 子路径规范化防穿透：服务端解析子路径时消除多斜杠与相对跳转。该机制防范目录穿透。
  - 视图未找到拦截：若请求的 `:viewName` 未注册，返回 404 与 `NOT_FOUND` 错误。
- 根路径向后兼容与视图匹配：
  - 传统根路径路由自动映射至对等的 `/api/v2/*` 端点。既有调用无需修改路径。
  - 智能令牌视图匹配：客户端请求根路径路由时，服务端提取 Bearer 令牌并遍历视图。若命中则激活对应视图策略。未提供令牌或未命中时回退至默认视图。

### 身份鉴权机制

服务端监听在非回环地址时，强制要求配置鉴权令牌。可通过启动参数 `--token` 或环境变量 `ACTIONDOCK_TOKEN` 注入。受保护端点支持以下认证方式：

- **HTTP 请求头鉴权**：
  ```text
  Authorization: Bearer <token>
  ```
- **URL 查询参数鉴权**：
  ```text
  ?token=<token>
  ```
  > [!IMPORTANT]
  > **安全策略提示**：URL 查询参数鉴权默认关闭。该设计防范 Token 泄露至日志。仅在显式开启 `--allow-query-token` 时允许该参数。生产环境建议仅使用请求头鉴权。

- **虚拟投影视图独立令牌**：每个虚拟视图可声明独立的鉴权令牌。访问命名空间端点必须提供匹配的令牌。访问根路径端点时，服务端自动识别令牌归属的视图。
- **防时序侧信道攻击**：令牌校验采用常数时间比对算法（`crypto.timingSafeEqual`）。系统遍历已注册视图执行比对，防范时序侧信道攻击。
- **未授权拦截**：配置了令牌但客户端未提供凭据时，服务端拒绝请求。服务端返回 401 与 `UNAUTHORIZED` 错误。

### 视图授权语义

- 视图以 `packageAllowlist` 与 `actionAllowlist` 声明范围。两份白名单取并集。整包授权包含未来新增动作。单动作引用必须为全限定格式，不支持通配符。
- 白名单省略表示不增加授权。两份白名单均无授权时，清单为空，服务端拒绝执行请求。`packageAllowlist: ["*"]` 显式开放全部，但不开启管理接口。
- 单动作授权包仅返回必要身份元数据与授权动作，不展开其他内容。动作列表、详情与执行记录按同一策略判断。规程与管理端点需要整包授权。受限授权下 `package=global` 不能绕过授权。

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
| `500 Internal Server Error` | Action 内部抛出未捕获错误或服务端底层错误 | `ACTION_EXECUTION_ERROR`, `ACTION_START_FAILED` |

---

## 系统与运维端点

### 系统健康探针 (`GET /api/v2/health`)

用于容器健康检测、Kubernetes 就绪探针与负载均衡存活探查：

- 请求方式：`GET`
- 鉴权说明：服务端配置令牌时需要通过鉴权校验。未配置令牌时可公开访问。
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
  （若服务端启动时开启了 `--expose-debug-info`，响应中额外包含 `projectRoot` 字段）。

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
  - `intent`（可选）：按关键词过滤能力。
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
      "packages": []
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
- 白名单过滤：若服务端配置了 `-P, --package` 或 `-A, --action` 白名单，列表中仅返回满足白名单条件的 Action。
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
- 响应结构：直接返回单个 `ActionSpec` 规范对象。若 Action 不存在返回 404 与 `ACTION_NOT_FOUND`。目标包未在白名单中返回 403 与 `PACKAGE_NOT_ALLOWED`。目标动作未在白名单中返回 403 与 `ACTION_FORBIDDEN`。

---

### Action 执行调度

#### 同步阻塞执行 (`POST /api/v2/actions/:actionId/run`)

直接同步执行目标 Action，等待其执行结束并返回最终结果信封：

- 请求端点：
  - 简短模式：`POST /api/v2/actions/:actionId/run`
  - 多包模式：`POST /api/v2/packages/:packageId/actions/:actionId/run`
- 白名单约束：服务端拦截未列入白名单的请求。服务端分别返回 403 与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。同时配置时需满足两项约束。
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
- 白名单约束：与同步模式一致。服务端拦截未列入白名单的请求，分别返回 403 与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。
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

## 执行历史、取消与事件流端点

### 查询执行历史记录 (`GET /api/v2/runs`)

- 请求方式：`GET`
- 鉴权说明：需要有效 Bearer 令牌。
- 白名单过滤：配置白名单时，返回的历史记录仅包含符合条件的记录。
- 查询参数：
  - `limit`（可选）：最大返回记录数，默认值为 50，夹紧在 1 至 500 区间。
  - `offset`（可选）：偏移游标条数（跳过的记录数），缺省为 0，与 `limit` 组合实现分页遍历。
  - `status`（可选）：按执行状态筛选。状态包含进行中状态（`pending`、`running`）以及终态（`success`、`failed`、`cancelled`、`timed_out`、`interrupted`）。
  - `actionId`（可选）：按动作标识筛选。
  - `packageId`（可选）：按包标识筛选。
  - `intent`（可选）：按关键词意图筛选。
  - `requestIds`（可选）：按幂等请求标识反查关联记录。支持重复参数形式传递多个标识。每个标识保留原样字符串。仅命中当前包范围内的已登记记录。
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
        "requestId": "client-req-001",
        "startedAt": "2026-09-12T10:00:00.000Z",
        "finishedAt": "2026-09-12T10:00:00.050Z",
        "input": { "name": "ActionDock" },
        "output": { "message": "Hello, ActionDock!" }
      }
    ]
  }
  ```
  执行时携带幂等标识的记录在返回体中携带 `requestId` 字段。无幂等登记的记录不包含该字段。

- 执行来源追踪属性（可选 `origin` 字段）：
  - 结构定义：`origin` 包含 `channel`、`viewName` 与 `authenticated`。
  - 来源可信：服务端根据实际生效视图生成来源，不接受请求体声明。未配置令牌的视图记为 `authenticated: false`。
  - 凭据安全：服务端不存储令牌原文或摘要。视图名仅关联访问配置。
  - 调用继承：嵌套子调用继承根调用来源。执行关系由 `rootRunId` 与 `parentRunId` 描述。
  - 历史兼容：存量旧记录与本地 CLI 或 STDIO 执行缺省 `origin` 字段。
  - 幂等语义：重复提交幂等请求命中既有记录时，返回首次执行来源，不覆盖旧来源。来源追踪不记录未生成执行的访问尝试。

### 查询单次执行详情 (`GET /api/v2/runs/:runId`)

- 请求方式：`GET`
- 响应结构：直接返回单个 `RunRecord` 实体对象。若任务不存在返回 404 与 `RUN_NOT_FOUND`。若任务所属包或动作未在允许白名单中，返回 403 与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。

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

- 授权范围：受限授权下，必须显式指定已获整包授权的包或精确到已授权动作。未指定范围或请求未授权动作均返回 403。`packageAllowlist: ["*"]` 保留全局清理能力。
- 请求参数（支持查询参数或 JSON 请求体）：
  - `packageId`：按目标包标识过滤
  - `actionId`：按目标动作标识过滤
  - `status`：按状态过滤（如 `success`、`failed`、`cancelled`、`timed_out`、`interrupted`）
  - `olderThan` 或 `olderThanMs`：仅清理早于指定时间跨度的记录（支持 `14d`、`7d`、`24h`、`30m` 或毫秒数值）
  - `keep`：保底保留的最新记录条数
- 响应样例：
  ```json
  {
    "ok": true,
    "clearedCount": 12
  }
  ```

### 按保留策略自动清理历史记录 (`POST /api/v2/runs/clean-expired`)

基于时间与数量双重保留策略，清理过期的终态执行记录：

- 授权范围：该接口不支持按包与动作限定范围。受限授权返回 403。仅全量授权（`packageAllowlist: ["*"]`）可以调用。
- 请求方式：`POST`
- 请求参数（JSON 请求体，可选覆盖默认策略）：
  - `maxAgeMs`：最大保留时长（毫秒，默认 14 天）
  - `maxRuns`：单包最大保留条数（默认 5000 条，超出按最旧先淘汰）
  - `minRetainRuns`：最小保底保留条数（默认 50 条，防止低频调用场景全部清空）
- 响应样例：
  ```json
  {
    "ok": true,
    "cleanedCount": 5
  }
  ```

### 订阅实时事件流 (`GET /api/v2/runs/:runId/events`)

采用标准 Server-Sent Events（SSE）协议向客户端推送实时日志与状态流：

- 请求方式：`GET`
- 响应头：`Content-Type: text/event-stream`
- 白名单校验：若任务所属包或动作未在允许白名单中，服务端拒绝推送并返回 403 与 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。
- 断点续传支持：
  - 客户端可在请求头携带 `Last-Event-ID: <eventId>`，或在 URL 中添加 `?after=<eventId>`。
  - 服务端从指定游标之后恢复推送。
  - 若游标已过期清理，服务端返回 410 与 `EVENT_CURSOR_EXPIRED`。
- 背压控制：
  - 客户端消费过慢导致队列超限时，服务端推送包含 `EVENT_BACKPRESSURE_LIMIT` 错误码的终止事件并关闭连接。

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
- 响应结构：返回规程定义对象。未找到时返回 404 与 `PLAYBOOK_NOT_FOUND`。

---

## 管理类端点（配置与持久化状态）

> [!IMPORTANT]
> **管理接口开启门禁**：配置与状态管理路由默认禁用。服务端启动时须传入 `--management` 参数，或在视图中配置 `enableManagement: true`。否则返回 403 与 `CAPABILITY_UNAVAILABLE` 错误。

### 配置安全列表查询 (`GET /api/v2/config`)

获取当前包或全局配置的安全脱敏视图：

- 请求方式：`GET`
- 查询参数：`package` 或 `packageId`（可选，缺省为默认包或全局）。传入 `key` 时改为单键查询，返回下面单项接口的 `item` 结构。
- 响应数据结构：
  ```json
  {
    "ok": true,
    "packageId": "example-tools",
    "configViewVersion": 1,
    "items": [
      {
        "key": "GITHUB_TOKEN",
        "configured": true,
        "secret": true,
        "source": "package",
        "redactedPaths": [""]
      },
      {
        "key": "MYSQL_191",
        "configured": true,
        "secret": true,
        "source": "package",
        "value": {
          "host": "127.0.0.1",
          "username": "root",
          "password": "********"
        },
        "redactedPaths": ["/password"]
      }
    ],
    "masked": {
      "GITHUB_TOKEN": [""],
      "MYSQL_191": ["/password"]
    },
    "values": {
      "GITHUB_TOKEN": "********",
      "MYSQL_191": {
        "host": "127.0.0.1",
        "username": "root",
        "password": "********"
      }
    }
  }
  ```
- 兼容性与安全说明：
  - 响应保留 `values` 字典作为安全投影。顶层敏感整项替换为 `********`。对象内部敏感字段局部掩码。
  - `configViewVersion: 1` 标识协议版本，为必选字段。缺失时客户端拒绝响应。
  - `items` 数组提供 `ConfigValueView` 对象列表，表达配置状态与脱敏路径。
  - `masked` 字典提供敏感键到脱敏路径的映射。

### 单项配置安全调阅 (`GET /api/v2/config/:key`)

调阅指定配置键的安全视图：

- 请求方式：`GET`
- 路径参数：`:key` 为具体配置键名（拒绝 `*` 通配符）
- 查询参数：`package` 或 `packageId`（可选）
- 客户端使用 `GET /api/v2/config?key=<编码键名>` 避免路由冲突。服务端须返回同键完整视图。无匹配项返回 `source: null` 视图。客户端拒绝不支持 `key` 参数的旧服务端。
- 响应数据结构：
  ```json
  {
    "ok": true,
    "packageId": "example-tools",
    "configViewVersion": 1,
    "item": {
      "key": "GITHUB_TOKEN",
      "configured": true,
      "secret": true,
      "source": "package",
      "redactedPaths": [""]
    }
  }
  ```

### 客户端归一化与协议契约规范

ActionDock 核心客户端对远端配置响应执行统一归一化处理：

- 本地与远端脱敏并集：客户端结合本地与服务端声明，取保护规则并集。本地声明只能加强远端保护。整项隐藏省略 `value` 时必须携带根隐藏路径。
- 协议版本门槛：客户端仅接受 `configViewVersion: 1` 的响应。缺失该字段时抛出 `PROTOCOL_UNSUPPORTED` 协议错误。
- 来源与状态自洽校验：`source` 必须为合法的 `ConfigSource` 值。该值必须与 `configured` 状态自洽。校验失败时抛出 `PROTOCOL_UNSUPPORTED`。客户端不猜测来源。
- 单项查询严格契约：单项查询要求服务端返回对应键的单项视图。无匹配项时服务端返回 `source: null` 视图。客户端拒绝列表响应，不用空列表伪装单项未命中。

### 环境变量满足度体检 (`GET /api/v2/config/env`)

校验当前包在宿主环境变量中所需配置的满足情况：

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
- 策略约束：继承全局策略或匹配的视图策略。`tools/list` 仅返回授权范围内的工具。`tools/call` 严格校验授权。

### 虚拟视图专属 MCP 端点 (`POST /views/:viewName/mcp`)

- 请求方式：`POST`（支持 Streamable HTTP 与 SSE 通信）
- 鉴权说明：需携带与 `:viewName` 视图匹配的 Bearer 令牌。
- 策略约束：严格限定在视图的授权范围内。单动作授权包的规程不得通过 MCP 资源与提示暴露，未授权工具不可调用。
- 视图禁用状态：若目标视图配置了 `enableMcp: false`，服务端拒绝连接并返回 404 与 `NOT_FOUND` 错误。
