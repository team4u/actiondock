# HTTP 微服务与 API 调度

当需要将 ActionDock 作为微服务部署，供远程 AI 智能体、持续集成流水线、自动化网关或外部前端系统通过网络调度时，可以使用 `ad serve` 启动轻量级 HTTP 服务。

服务端原生基于 Node.js 模块构建，提供能力自省、同步调用、异步任务生命周期管理以及实时事件流推送能力。部署完成后，既可通过标准 RESTful API 远程调用，也可通过本地 CLI 的 Profile 机制透明接入与统一管控。

---

## 启动服务

### 单工程项目模式（推荐）

在包含 `actiondock.json` 的工程目录中运行，服务端会自动加载本项目及其声明锁定的全部 Action 依赖：

```bash
# 生产与远程微服务（监听所有网卡，强制要求令牌鉴权）
ad serve --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret"

# 本地单机调试（默认绑定 127.0.0.1 本地回环）
ad serve --port 5177 --token "sk-actiondock-secret"
```

### 包与动作访问白名单（细粒度权限隔离）

在多包工作区、集成宿主工程或共享部署节点中，如果仅希望向外部客户端暴露特定的 Action Package 或特定动作，可以使用 `-P, --package <package-id>` 与 `-A, --action <action-ref>` 参数指定白名单。两项参数均支持多次指定或使用逗号分隔：

```bash
# 启动微服务并仅对外暴露 github-tools 与 ci-tools 两个包（逗号分隔，推荐）
ad serve -P github-tools,ci-tools --port 5177 --token "sk-actiondock-secret"

# 限制特定动作白名单（支持短名与全限定名，多次指定或逗号分隔）
ad serve -A sample.greet,calc.add --port 5177 --token "sk-actiondock-secret"

# 同时指定包白名单与动作白名单（取两者权限交集）
ad serve -P github-tools -A github-tools/list-prs --port 5177 --token "sk-actiondock-secret"
```

#### 白名单保护与隔离机制

- **启动状态与横幅展示**：
  服务成功启动时，控制台横幅将输出当前激活的包清单与动作清单（如 `* Packages: github-tools, ci-tools` 与 `* Actions: sample.greet`），清晰标识服务的能力边界。
- **全方位 API 路由与端点保护**：
  - **能力发现与自省过滤**：`GET /api/v2/info` 与 `GET /api/v2/actions` 仅返回白名单内包含的 Package 及 Action 元数据；未在白名单中的内容在列表中被彻底过滤，对客户端不可见。
  - **显式路径与执行阻断**：任何针对未授权包或动作的查询与执行请求（包括 `GET /api/v2/packages/:packageId/...`、`GET /api/v2/actions/:id`、`POST /api/v2/actions/:id/run`、`POST /api/v2/actions/:id/start` 等），均会被服务端严格阻断，返回 HTTP 403 状态码及错误码 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。
  - **历史记录与任务治理隔离**：`GET /api/v2/runs` 执行记录列表自动应用白名单过滤；未授权包或动作的单次详情查询（`GET /api/v2/runs/:runId`）、任务主动取消（`POST /api/v2/runs/:runId/cancel`）与实时事件流推送（`GET /api/v2/runs/:runId/events`）均返回 403 状态码。
  - **环境诊断与规程隔离**：`GET /api/v2/doctor`、`GET /api/v2/playbooks` 以及配置/状态接口同样限制在白名单允许的包与动作范围内。
- **统一内嵌 MCP 端点同步受控**：
  - 服务默认挂载的统一内嵌 `/mcp` 协议端点（支持通过 `--no-mcp` 关闭）会完全同步继承包与动作白名单。
  - 接入 MCP 协议的智能体客户端在调用 `tools/list` 时仅能感知到白名单内的工具集合；若客户端发起调用未授权的工具（`tools/call`），服务端将直接拒绝调用。
  - MCP 任务扩展（`tasks/get`、`tasks/cancel`、`tasks/list`）同步实施白名单校验与过滤。
- **严格的包与动作解析校验**：
  - 参数支持传入当前工作区工程、本地相对/绝对路径或通过 `ad link` 注册在全局注册表中的包标识符；动作参数支持短名与全限定名。
  - 若传入的包标识符在本地或全局注册表中无法定位，服务端在启动解析阶段将直接报错并终止退出，防止因拼写错误导致非预期的空服务或隐蔽安全隐患。

### 单端口多权限与虚拟投影视图

在多场景协作与自动化集成中，单个 HTTP 微服务往往需要同时面向不同权限级别的调用方提供服务。例如，前端只读界面仅需调阅 Action 契约与执行历史，自动化智能体仅允许调度特定受信任动作，而运维管理平台则需要读写持久化状态与系统配置。

通过虚拟投影视图机制，ActionDock 支持在单个服务监听端口上划分出多个具备独立安全策略的虚拟端点视图，免去为不同权限角色启动多个重复进程的运维成本。

#### 视图配置声明方式

- 项目配置文件声明：
  在项目根目录 `actiondock.json` 中的 `server.views` 字段内配置视图映射字典或数组：
  ```json
  {
    "name": "my-service",
    "server": {
      "views": {
        "readonly": {
          "token": "sk-readonly-secret",
          "packageAllowlist": ["github-tools"],
          "actionAllowlist": ["github-tools/list-prs"],
          "enableManagement": false,
          "enableMcp": true
        },
        "agent": {
          "token": "sk-agent-secret",
          "packageAllowlist": ["github-tools", "ci-tools"],
          "actionAllowlist": ["github-tools/list-prs", "ci-tools/trigger-build"],
          "enableManagement": false,
          "enableMcp": true
        },
        "admin": {
          "token": "sk-admin-secret",
          "enableManagement": true,
          "enableMcp": false
        }
      }
    }
  }
  ```
- 外部配置文件指定：
  通过 `--views-file <path>` 参数加载外部 JSON 配置文件：
  ```bash
  ad serve --port 5177 --views-file ./config/views.json
  ```
  外部配置文件支持直接对象字典、对象数组、或包含 `views` / `server.views` 的外层包装结构。此外，亦支持通过 `--views <json>` 选项以 JSON 字符串直接内联传参。
- 配置合并优先级：
  命令行 `--views` 优先于 `--views-file`，`--views-file` 优先于 `actiondock.json` 中的 `server.views` 声明。

#### 视图命名空间路径规范

- HTTP API 命名空间端点：
  多视图 HTTP API 统一挂载在 `/views/:viewName/api/v2/*` 路径下，例如：
  - 查询只读视图可用动作：`GET /views/readonly/api/v2/actions`
  - 调度智能体视图授权动作：`POST /views/agent/api/v2/actions/github-tools/list-prs/run`
  - 查询管理员视图配置信息：`GET /views/admin/api/v2/config`
  服务端在路由分发前自动对 `:viewName` 之后的子路径执行规范化解析，自动消除多斜杠与相对路径跳转，防范路径混淆与目录穿透。
- 专属 MCP 协议端点：
  各视图的专属 MCP 端点挂载在 `/views/:viewName/mcp` 路径下。外部智能体可通过其专属 URL 接入，该视图暴露的工具集合严格受限于该视图的权限声明。
- 视图不存在拦截：
  若客户端请求的 `:viewName` 未在服务端注册，服务端直接返回 HTTP 404 状态码与 `NOT_FOUND` 错误码。

#### 多维度安全隔离保障

- 包白名单隔离：通过 `packageAllowlist` 限制视图可见与可调用的包。能力发现接口自动过滤非白名单包；显式调用未授权包直接返回 403 `PACKAGE_NOT_ALLOWED`。
- 动作白名单隔离：通过 `actionAllowlist` 精准控制动作权限（支持短名与全限定名）。执行未授权动作直接拦截并返回 403 `ACTION_FORBIDDEN`；历史任务列表与任务取消同步过滤。
- 管理权限门禁：通过 `enableManagement` 控制配置与状态接口。默认关闭，仅在显式配置为 `true` 的视图下开放 `/api/v2/config` 与 `/api/v2/state` 端点，未授权视图请求一律返回 403 `CAPABILITY_UNAVAILABLE`。
- 模型上下文协议工具隔离：各视图专属 MCP 端点根据当前视图白名单过滤 `tools/list` 工具清单，并在 `tools/call` 时严格执行白名单拦截；若视图配置 `enableMcp: false`，则彻底关闭该视图的 MCP 端点并返回 404。

#### 根路径与单令牌向后兼容

- 传统路由完全兼容：既有客户端请求根路径路由（`/api/v2/*` 与 `/mcp`）完全保持向后兼容，无需调整调用路径。
- 智能令牌视图匹配：当客户端请求根路径时，服务端提取请求中的 Bearer 令牌，并在全部已注册视图中使用常数时间安全比对进行遍历匹配；若命中匹配，自动激活该视图对应的安全策略。
- 默认视图平滑回退：若客户端未携带令牌或未命中任何自定义视图，请求自动降级应用默认视图（继承全局命令行参数 `--token`、`-P`、`-A`、`--management` 等构建的默认策略），确保既有系统的平滑升级与零迁移成本。

### 原生 HTTPS 传输加密支持

ActionDock 服务端原生支持通过 TLS 运行 HTTPS 协议，支持零配置即时启动与显式证书配置两种模式：

- 零配置自签名模式（本地与内网开发）：
  ```bash
  # 自动生成非对称私钥与自签名证书并启动 HTTPS 服务
  ad serve --https --port 5177 --token "sk-actiondock-secret"
  ```
  启用 `--https` 且未提供证书文件时，系统会在本地家目录缓存中检查或自动签发 X.509 证书与私钥资产。证书自动包含完整的 `localhost`、`127.0.0.1`、`::1`、主机名以及当前活动网卡局域网 IP，并支持 7 天临期自动重签。
- 生产证书模式（正式部署）：
  ```bash
  # 加载企业或公共受信任证书机构签发的凭据
  ad serve --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret" \
    --tls-cert /path/to/cert.pem \
    --tls-key /path/to/key.pem \
    --tls-ca /path/to/ca.pem
  ```
  支持通过环境变量 `ACTIONDOCK_TLS_CERT` 与 `ACTIONDOCK_TLS_KEY` 注入证书与私钥路径。私钥文件受到严格文件权限保护。

---

## 安全机制与身份鉴权

- 非回环强制令牌鉴权：当 `--host` 设置为非回环地址（如 `0.0.0.0` 或物理网卡 IP）时，框架强制要求配置鉴权令牌（通过 `--token` 参数或环境变量 `ACTIONDOCK_TOKEN` 注入），否则服务端拒绝启动。
- 单端口多权限与虚拟视图：支持通过虚拟投影视图为不同调用角色定义细粒度策略，各视图独立的鉴权令牌、包白名单、动作白名单与管理权限由统一策略守卫严格把关。
- 权限隔离与白名单保护：通过 `-P, --package` 与 `-A, --action` 指定包与动作白名单，使服务端仅对外暴露受信任能力。无论 RESTful API 还是内嵌 MCP 端点均统一受控，访问未授权包返回 403 `PACKAGE_NOT_ALLOWED`，访问未授权动作返回 403 `ACTION_FORBIDDEN`。
- 常数时间安全比对防范时序攻击：内置常数时间比对算法验证请求令牌。在多视图环境下遍历已注册视图进行令牌匹配时，同样坚持常数时间全量比对，杜绝利用微秒级时延差异推测敏感凭据的时序侧信道攻击。
- 请求体上限防御：默认限制单个 JSON 请求体大小为 1MB（可通过 `--max-body 10mb` 调整），超限自动拦截并返回 413 状态码。
- 鉴权传参方式：受保护接口默认推荐在 HTTP 请求头中携带 `Authorization: Bearer <token>`。若需要通过 URL 查询参数 `?token=<token>` 传参，服务端启动时需显式开启 `--allow-query-token` 安全开关（默认关闭）。

---

## 核心调用范式示例

### 同步阻塞执行

适用于耗时较短的即时计算或查询任务，服务端在 Action 执行完毕后直接返回完整的标准 JSON 信封：

```bash
curl -X POST http://localhost:5177/api/v2/actions/list-prs/run \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "repo": "team4u/actiondock" }
  }'
```

返回数据：
```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat: optimize http api layout"
      }
    ]
  }
}
```

### 异步启动与任务流

针对长耗时任务，使用异步启动端点。服务端立即响应并返回执行标识（Run ID）与事件流订阅地址：

#### 发起异步执行

```bash
curl -X POST http://localhost:5177/api/v2/actions/build-task/start \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "target": "release" }
  }'
```

返回票据：
```json
{
  "ok": true,
  "runId": "01JMB394XYZ...",
  "streamUrl": "/api/v2/runs/01JMB394XYZ.../events"
}
```

#### 订阅实时事件流（Server-Sent Events）

通过标准 SSE 接口监听执行过程中的进度更新与日志：

```bash
curl -N http://localhost:5177/api/v2/runs/01JMB394XYZ.../events \
  -H "Authorization: Bearer sk-actiondock-secret"
```

#### 手动中止任务

若任务需要提前取消，向取消端点发送请求，服务端将向底层 Action 传播中断信号并回收受管子进程树：

```bash
curl -X POST http://localhost:5177/api/v2/runs/01JMB394XYZ.../cancel \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "用户主动取消操作" }'
```

---

## 配合 CLI Profile 远程调度与消费

除了直接使用 HTTP 客户端发起网络请求，ActionDock CLI 自身亦是 HTTP 微服务的一等公民客户端。通过本地 Profile 机制，无需编写网络请求代码或手动拼接鉴权头，即可在本地终端中对远端 `ad serve` 节点执行调度、日志查看与任务控制。

### 添加远端服务节点

在本地开发环境中，通过 `ad profile add` 将运行中的 HTTP 服务注册为具名环境配置：

```bash
# 添加远端生产节点
ad profile add prod --server https://10.0.0.12:5177 --token "sk-actiondock-secret"

# 添加内网自签名 HTTPS 节点（开启 -k/--insecure 自动跳过证书合法性校验）
ad profile add dev-cluster --server https://192.168.1.100:5177 --token "sk-actiondock-secret" -k

# 或通过环境变量引用令牌（推荐，避免命令历史记录泄露凭据）
ad profile add staging --server https://actiondock.internal.example.com --token-env STAGING_TOKEN
```

### 连通性探测

注册后，可执行连通性自检命令验证网络链路与鉴权令牌：

```bash
ad profile test prod
```

### 跨环境透明调度

在执行 Action 时，只需通过 `-p, --profile` 参数指定目标节点，CLI 会自动将调用转发至远端 HTTP 服务。远程调用同样原生支持 Flat JsonValue Encoding v1 规范：

```bash
# 远程同步调用 Action（使用 -- 隔离控制平面与数据平面入参）
ad run list-prs --profile prod -- repo=team4u/actiondock

# 包含数值与 JSON 结构赋值
ad run get-pr --profile prod -- repo=team4u/actiondock prNumber:=101

# 远程异步后台启动（异步执行模式依赖长时间运行的 ad serve 服务端）
ad run heavy-data-sync --profile prod --async -- task=sync

# 复杂或多行参数推荐通过文件传参（与扁平参数严格互斥）
ad run list-prs --profile prod --input-file ./params.json
```

CLI 在本地对扁平参数完成解析、有限数校验与物化后，将其作为标准的 JSON 数据载荷安全发送至远端 HTTP 微服务端；若参数语法非法或存在路径冲突，本地立即拦截报错并以退出码 2 退出。

### 远端任务生命周期与日志管理

通过 CLI 可直接追踪远端服务端承载的异步任务生命周期与取消控制：

```bash
# 查询远端历史任务列表
ad runs list --profile prod

# 查询指定任务终态详情与执行耗时
ad runs show <runId> --profile prod

# 中止远端正在执行的长任务并级联回收子进程树
ad runs cancel <runId> --profile prod --reason "手动中止任务"
```

### 切换默认执行环境

若需要持续对某个远端微服务进行操作，可通过 `ad profile use` 将其设为默认目标：

```bash
# 切换默认环境为 prod
ad profile use prod

# 切换后后续命令默认面向远端执行，无需显式附加 --profile 参数
ad run list-prs -- repo=team4u/actiondock
ad info

# 切回本地单机环境
ad profile use local
```

关于更完整的多环境节点配置、持久化权限保护与 Profile 命令行参数规范，请参阅 [多环境 Profile 远程调度机制](configuration.md#多环境-profile-远程调度机制)。

---

## 端点能力与接口总览

ActionDock HTTP 微服务提供了一整套标准端点：

| 能力分类 | 主要端点 | 核心用途 |
| :--- | :--- | :--- |
| **系统探针** | `GET /api/v2/health` | 容器健康探查与负载均衡存活检测（未配置 Token 时免鉴权；配置 Token 后需鉴权） |
| **环境诊断** | `GET /api/v2/doctor` | 查看宿主运行时状态与存储驱动健康度 |
| **全局自省** | `GET /api/v2/info` | 调阅已加载包大纲、Action 列表与意图检索 |
| **Action 清单** | `GET /api/v2/actions` | 列出当前全部可用 Action 摘要 |
| **契约规范** | `GET /api/v2/actions/:id` | 调阅指定 Action 的输入输出模式与依赖规范 |
| **同步执行** | `POST /api/v2/actions/:id/run` | 阻塞调用 Action 并获取最终结果信封 |
| **异步启动** | `POST /api/v2/actions/:id/start` | 启动后台长任务并返回票据与订阅地址 |
| **运行历史** | `GET /api/v2/runs` | 查询历史任务执行记录与状态 |
| **任务详情** | `GET /api/v2/runs/:id` | 获取单次任务终态数据与耗时统计 |
| **任务取消** | `POST /api/v2/runs/:id/cancel` | 中止正在执行的任务并清理子进程树 |
| **事件推送** | `GET /api/v2/runs/:id/events` | 基于 SSE 订阅实时日志与状态流（支持断点续传） |
| **规程查询** | `GET /api/v2/playbooks` | 列出推荐的操作规程与关联 Action |
| **统一 MCP 端点** | `POST /mcp` | 内嵌 MCP 协议端点（Streamable HTTP/SSE），同步受当前生效策略白名单约束 |
| **虚拟视图 API** | `ALL /views/:viewName/api/v2/*` | 访问指定虚拟视图下的 HTTP API，实施该视图专属的白名单与管理权限 |
| **虚拟视图 MCP 端点** | `POST /views/:viewName/mcp` | 访问指定虚拟视图专属的 MCP 协议端点，工具列表与调用严格隔离在该视图权限范围内 |

---

## 完整接口契约与相关指引

关于完整的请求响应 JSON Schema、URL 参数、多包路由模式（`/packages/:pkg/actions/:id/...`）以及全量错误码定义，请参阅：

- [HTTP API 接口契约](../reference/http-api.md)
- [多环境 Profile 远程调度机制](configuration.md#多环境-profile-远程调度机制)
- [CLI 命令行参考（Profile 管理命令）](../reference/cli.md#多环境与远程-profile-管理)
