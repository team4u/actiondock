# HTTP 微服务与 API 调度

将 ActionDock 作为微服务部署时，可使用 `ad serve` 启动 HTTP 服务。
外部智能体、流水线或前端系统可通过网络调度服务。

服务端基于 Node.js 模块构建。
服务提供自省、同步调用、异步任务管理与实时事件流推送。
部署后可通过 RESTful API 远程调用，也可通过本地 Profile 统一管控。

---

## 启动服务

### 单工程项目模式（推荐）

在包含 `actiondock.json` 的工程目录中启动。
服务端会自动加载当前项目及其锁定的全部 Action 依赖：

```bash
# 生产与远程微服务（监听所有网卡，使用令牌鉴权并显式开放当前宿主的全部包）
ad serve --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret" -P '*'

# 本地单机调试（默认绑定 127.0.0.1 本地回环）
ad serve --port 5177 --token "sk-actiondock-secret" -P '*'
```

### 包与动作访问白名单

若需向外部暴露特定 Package 或特定动作，可配置授权白名单。
使用 `-P, --package <package-id>` 与 `-A, --action <action-ref>` 传参。
两份白名单取并集。
`-P` 授予所列整包当前与未来全部动作。
`-A` 仅接受 `packageId/actionId` 全限定精确引用，拒绝短名与通配符。
两项参数均支持多次指定或逗号分隔：

```bash
# 启动微服务并授予 github-tools 与 ci-tools 两个整包（逗号分隔，推荐）
ad serve -P github-tools,ci-tools --port 5177 --token "sk-actiondock-secret"

# 限制特定动作授权白名单（仅接受全限定名，多次指定或逗号分隔）
ad serve -A sample-tools/greet,calc-tools/add --port 5177 --token "sk-actiondock-secret"

# 同时指定包与动作白名单（取并集：github-tools 整包 + sample-tools/greet 单动作）
ad serve -P github-tools -A sample-tools/greet --port 5177 --token "sk-actiondock-secret"

# 显式全量访问（不支持其他通配模式，不自动开启管理端点）
ad serve -P '*' --port 5177 --token "sk-actiondock-secret"

# 未声明 -P/-A 时默认视图没有任何授权，服务无动作可用
```

#### 白名单保护与隔离机制

- 启动状态与横幅显示：服务成功启动时，控制台横幅输出激活的包与动作清单。
- 能力发现与自省过滤：`GET /api/v2/info` 与 `GET /api/v2/actions` 仅返回授权范围内的元数据。单动作授权的包仅返回最小身份元数据与已授权动作。未授权内容在列表中彻底过滤。
- 显式路径与执行阻断：服务端严格阻断未授权包或动作的查询与执行请求。服务端返回 HTTP 403 状态码及错误码 `PACKAGE_NOT_ALLOWED` 或 `ACTION_FORBIDDEN`。动作按实际全限定引用判定，未知包不放行。
- 历史记录与任务治理隔离：`GET /api/v2/runs` 执行记录列表自动过滤未授权内容。未授权包或动作的详情查询、任务取消与事件推送均返回 403 状态码。
- 环境诊断与规程隔离：`GET /api/v2/doctor`、`GET /api/v2/playbooks` 与配置状态接口仅对整包授权开放。单动作授权不开放规程、诊断与管理能力。
- 内嵌 MCP 端点同步受控：服务默认挂载的 `/mcp` 端点继承白名单规则。`tools/list` 仅返回授权工具。调用未授权工具时服务端直接拒绝。MCP 任务扩展同步实施白名单过滤。
- 包与动作解析校验：参数支持工作区工程路径或通过 `ad link` 注册的包标识符。若包标识符无法定位，服务端在启动解析阶段直接报告错误并终止退出。

### 单端口多权限与虚拟投影视图

单个微服务常需同时面向不同权限级别的调用方。
前端只读界面仅需调阅契约与执行历史。
智能体仅允许调度受信任动作。
管理平台需要读写持久化状态与系统配置。

ActionDock 支持在单个端口上划分多个具备独立策略的虚拟视图。
使用者无需为不同权限角色启动多个服务进程。

#### 视图配置声明方式

- 项目配置文件声明：
  在项目根目录 `actiondock.json` 的 `server.views` 字段内配置视图映射：
  ```json
  {
    "name": "my-service",
    "server": {
      "views": {
        "default": {
          "packageAllowlist": [],
          "actionAllowlist": [],
          "enableMcp": false
        },
        "readonly": {
          "token": "sk-readonly-secret",
          "actionAllowlist": ["github-tools/list-prs"],
          "enableManagement": false,
          "enableMcp": true
        },
        "agent": {
          "token": "sk-agent-secret",
          "packageAllowlist": ["github-tools"],
          "actionAllowlist": ["ci-tools/trigger-build"],
          "enableManagement": false,
          "enableMcp": true
        },
        "admin": {
          "token": "sk-admin-secret",
          "packageAllowlist": ["*"],
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
  外部配置文件支持对象字典、对象数组，或包含 `views` 的包装结构。系统也支持通过 `--views <json>` 选项直接传入 JSON 字符串。
- 配置合并优先级：
  命令行 `--views` 优先于 `--views-file`。`--views-file` 优先于 `actiondock.json` 中的声明。同名视图按字段覆盖合并。上层提供的字段整项替换基础值，未提供的字段保留基础值。

#### 视图授权语义与安全边界

- 并集授权：视图通过 `packageAllowlist` 与 `actionAllowlist` 声明授权，两份白名单取并集。
  - `packageAllowlist` 授予整包能力，覆盖当前与未来新增的全部动作。
  - `actionAllowlist` 仅接受 `packageId/actionId` 全限定精确引用，拒绝短名与通配符。
  - 两份白名单取并集。例如包白名单包含 `github-tools`，动作白名单包含 `ci-tools/trigger-build`，则前者整包可用，后者仅单动作可用。
  - 某一白名单为空时不取消另一白名单授权。两份均为空时，服务拒绝执行请求。
  - `packageAllowlist: ["*"]` 为全量访问标记，但不自动开启 `enableManagement`。
- 视图独立性：命名视图不继承默认视图的白名单与令牌。命令行 `-P/-A` 不是所有视图的权限上限。默认视图无授权时不暴露动作。新增命名视图不会关闭默认视图与根路径。建议为默认视图显式配置空白名单，或配置独立令牌。
- 调用边界：视图授权仅约束对外入口。Action 内部调用仍遵循 `uses` 与运行时依赖规则。内部依赖调用不受视图直接拦截。
- 最小发现投影：单动作授权的包在自省接口中仅返回最小元数据与已授权动作。不暴露完整清单与配置。整包授权返回脱敏后的完整结构。历史记录按动作逐条过滤。发现结果仅包含真实注册动作，查询失败时直接返回错误。

#### 视图命名空间路径规范

- HTTP API 命名空间端点：
  多视图统一挂载在 `/views/:viewName/api/v2/*` 路径下：
  - 查询只读视图可用动作：`GET /views/readonly/api/v2/actions`
  - 调度智能体视图授权动作：`POST /views/agent/api/v2/actions/github-tools/list-prs/run`
  - 查询管理员视图配置信息：`GET /views/admin/api/v2/config`
  服务端路由分发前规范化子路径，消除多斜杠与跳转，防范目录穿透。
- 专属 MCP 协议端点：
  专属 MCP 端点挂载在 `/views/:viewName/mcp` 路径下。外部智能体可通过专属 URL 接入，工具集合受限于视图权限声明。
- 视图不存在拦截：
  若请求的 `:viewName` 未注册，服务端直接返回 HTTP 404 与 `NOT_FOUND` 错误。

#### 多维度安全隔离保障

- 包能力授权隔离：`packageAllowlist` 覆盖整包动作。能力发现接口自动过滤未授权包。调用未授权包直接返回 403 `PACKAGE_NOT_ALLOWED`。
- 单动作授权隔离：`actionAllowlist` 精准控制动作权限。执行未授权动作返回 403 `ACTION_FORBIDDEN`。包不可见时返回 `PACKAGE_FORBIDDEN`。单动作授权包不开放其余动作、规程与诊断。
- 并集授权隔离：两份白名单取并集。若两份白名单均无授权，服务拒绝执行请求。`packageAllowlist: ["*"]` 覆盖全部包。
- 管理权限门禁：`enableManagement` 控制配置与状态接口。默认关闭。仅在显式配置为 `true` 的视图开放对应端点，未授权视图返回 403 `CAPABILITY_UNAVAILABLE`。`packageAllowlist: ["*"]` 不自动开启管理能力。
- 历史清理边界：受限授权下，`runs/clear` 须指定整包授权的包或精确动作。越界清理返回 403。`packageAllowlist: ["*"]` 保留全局清理能力。
- 规程与诊断边界：规程与环境诊断仅对整包授权开放。单动作授权不开放规程与诊断，受限授权下全局 doctor 返回拒绝。
- MCP 工具隔离：各视图专属端点根据策略过滤 `tools/list`，调用违规工具时严格拦截。单动作授权不泄露规程提示。若配置 `enableMcp: false` 则关闭该端点并返回 404。

#### 根路径与默认视图

- 传统路由兼容：既有客户端请求根路径（`/api/v2/*` 与 `/mcp`）保持兼容，无需调整路径。
- 令牌视图匹配：客户端请求根路径时，服务端提取 Bearer 令牌。服务端遍历已注册视图进行常数时间匹配。命中后自动激活对应策略。
- 默认视图回退：若未携带令牌或未命中视图，请求降级至默认视图。未声明 `-P/-A` 时默认视图无授权。开放服务需显式声明白名单，全量访问使用 `-P '*'`。

### 原生 HTTPS 传输加密支持

ActionDock 服务端支持 TLS 加密，提供两种证书模式：

- 零配置自签名模式（本地与内网开发）：
  ```bash
  # 自动创建私钥与自签名证书并启动 HTTPS 服务
  ad serve --https --port 5177 --token "sk-actiondock-secret"
  ```
  启用 `--https` 且未提供证书文件时，系统自动签发 X.509 证书与私钥。证书包含 `localhost`、`127.0.0.1`、`::1`、主机名与网卡 IP，支持临期自动重签。
- 生产证书模式（正式部署）：
  ```bash
  # 加载受信任证书机构签发的凭据
  ad serve --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret" \
    --tls-cert /path/to/cert.pem \
    --tls-key /path/to/key.pem \
    --tls-ca /path/to/ca.pem
  ```
  可通过环境变量 `ACTIONDOCK_TLS_CERT` 与 `ACTIONDOCK_TLS_KEY` 注入证书与私钥路径。系统严格保护私钥文件权限。

---

## 安全机制与身份鉴权

- 非回环强制令牌鉴权：`--host` 配置为非回环地址时，框架强制要求配置鉴权令牌。可通过 `--token` 或环境变量 `ACTIONDOCK_TOKEN` 注入，否则拒绝启动。
- 单端口多权限与虚拟视图：支持通过虚拟投影视图定义细粒度策略。各视图独立的令牌与授权由统一策略把关。
- 权限隔离与授权保护：通过 `-P` 与 `-A` 声明白名单（取并集），仅暴露受信任能力。访问未授权包返回 403 `PACKAGE_NOT_ALLOWED`，访问未授权动作返回 403 `ACTION_FORBIDDEN`。
- 常数时间比对防范时序攻击：使用常数时间算法验证请求令牌。系统遍历已注册视图比对全部令牌，防范时序侧信道攻击。
- 请求体上限防御：默认限制单个 JSON 请求体大小为 1MB（可通过 `--max-body 10mb` 调整）。超限自动拦截并返回 413 状态码。
- 鉴权传参方式：受保护接口推荐在请求头携带 `Authorization: Bearer <token>`。若需通过查询参数 `?token=<token>` 传参，需开启 `--allow-query-token` 开关。

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

若任务需提前取消，可向取消端点发送请求。服务端向底层 Action 发送中断信号并回收子进程树：

```bash
curl -X POST http://localhost:5177/api/v2/runs/01JMB394XYZ.../cancel \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "主动取消操作" }'
```

---

## 配合 CLI Profile 远程调度与消费

CLI 亦是微服务的客户端。
通过本地 Profile 机制，可在本地终端对远端节点执行调度与任务控制。

### 添加远端服务节点

在本地开发环境中，通过 `ad profile add` 将 HTTP 服务注册为具名环境配置：

```bash
# 添加远端生产节点
ad profile add prod --server https://10.0.0.12:5177 --token "sk-actiondock-secret"

# 添加内网自签名 HTTPS 节点（开启 -k/--insecure 自动跳过证书合法性校验）
ad profile add dev-cluster --server https://192.168.1.100:5177 --token "sk-actiondock-secret" -k

# 或通过环境变量引用令牌（推荐，避免命令历史记录泄露凭据）
ad profile add staging --server https://actiondock.internal.example.com --token-env STAGING_TOKEN
```

### 连通性探测

注册后，可执行连通性校验命令验证网络链路与鉴权令牌：

```bash
ad profile test prod
```

### 跨环境透明调度

执行 Action 时，通过 `-p, --profile` 指定目标节点。CLI 自动将调用转发至远端服务。远程调用支持 Flat 编码规范：

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

CLI 在本地完成参数解析、有限数校验与物化，然后发送至远端服务端。若参数语法非法或存在路径冲突，本地立即拦截并以退出码 2 退出。

### 远端任务生命周期与日志管理

通过 CLI 可直接追踪远端异步任务并执行取消控制：

```bash
# 查询远端历史任务列表
ad runs list --profile prod

# 查询指定任务终态详情与执行耗时
ad runs show <runId> --profile prod

# 阻塞等待多个远端任务到达终态后聚合退出（超时仅退出等待，不取消任务）
ad runs watch <runId1> <runId2> --profile prod --timeout 10m

# 中止远端正在执行的长任务并级联回收子进程树
ad runs cancel <runId> --profile prod --reason "手动中止任务"
```

### 切换默认执行环境

若需持续操作某个远端服务，可通过 `ad profile use` 将其设为默认目标：

```bash
# 切换默认环境为 prod
ad profile use prod

# 切换后后续命令默认面向远端执行，无需显式附加 --profile 参数
ad run list-prs -- repo=team4u/actiondock
ad info

# 切回本地单机环境
ad profile use local
```

关于更完整的多环境节点配置与 Profile 命令行参数规范，请参阅 [多环境 Profile 远程调度机制](configuration.md#多环境-profile-远程调度机制)。

---

## 端点能力与接口总览

ActionDock HTTP 微服务提供了一整套标准端点：

| 能力分类 | 主要端点 | 核心用途 |
| :--- | :--- | :--- |
| **系统探针** | `GET /api/v2/health` | 容器健康探查与存活检测（未配置 Token 时免鉴权，配置 Token 后需鉴权） |
| **环境诊断** | `GET /api/v2/doctor` | 查看宿主运行时状态与存储驱动健康度 |
| **全局自省** | `GET /api/v2/info` | 调阅已加载包大纲、Action 列表与意图检索 |
| **Action 清单** | `GET /api/v2/actions` | 列出当前全部可用 Action 摘要 |
| **契约规范** | `GET /api/v2/actions/:id` | 调阅指定 Action 的输入输出模式与依赖规范 |
| **同步执行** | `POST /api/v2/actions/:id/run` | 阻塞调用 Action 并获取最终结果信封 |
| **异步启动** | `POST /api/v2/actions/:id/start` | 启动后台长任务并返回票据与订阅地址 |
| **执行历史** | `GET /api/v2/runs` | 查询历史任务执行记录与状态 |
| **任务详情** | `GET /api/v2/runs/:id` | 获取单次任务终态数据与耗时统计 |
| **任务取消** | `POST /api/v2/runs/:id/cancel` | 中止正在执行的任务并清理子进程树 |
| **事件推送** | `GET /api/v2/runs/:id/events` | 基于 SSE 订阅实时日志与状态流（支持断点续传） |
| **规程查询** | `GET /api/v2/playbooks` | 列出推荐的操作规程与关联 Action |
| **统一 MCP 端点** | `POST /mcp` | 内嵌 MCP 协议端点（Streamable HTTP/SSE），同步受当前生效策略白名单约束 |
| **虚拟视图 API** | `ALL /views/:viewName/api/v2/*` | 访问指定虚拟视图下的 HTTP API，实施该视图专属的白名单与管理权限 |
| **虚拟视图 MCP 端点** | `POST /views/:viewName/mcp` | 访问指定虚拟视图专属的 MCP 协议端点，工具列表与调用严格隔离在该视图权限范围内 |

---

## 完整接口契约与参考指引

关于完整的请求响应 JSON Schema、URL 参数、多包路由模式以及全量错误码定义，请参阅：

- [HTTP API 接口契约](../reference/http-api.md)
- [多环境 Profile 远程调度机制](configuration.md#多环境-profile-远程调度机制)
- [CLI 命令行参考（Profile 管理命令）](../reference/cli.md#多环境与远程-profile-管理)
