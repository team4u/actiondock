# HTTP 远程微服务与 API 调度

当需要将 ActionDock 部署为微服务，供远程 AI 智能体、Webhook、持续集成流水线或前端业务系统调度时，可以使用 `ad serve` 启动轻量级 HTTP 调度微服务。

服务端基于 Node.js 原生模块构建，全面对齐 CLI 的全套能力，包括能力自省、动作执行、规程检索、任务流、状态管理、配置治理、深度体检以及一体化 Model Context Protocol 协议网关。

---

## 启动姿态

`ad serve` 具备高度灵活性，支持多种启动姿态：

### 全局路由模式（推荐，任意目录直接启动）
在系统的任意终端路径直接执行 `ad serve`。服务端自动启动为全局路由模式，动态感知并通过全局注册表聚合所有通过 `ad link` 注册的包与工作区：

```bash
# 生产或云端远程微服务启动（监听非回环地址 0.0.0.0，强制要求令牌鉴权）
ad serve --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret"

# 本地单机调试（默认绑定 127.0.0.1 回环地址）
ad serve --port 5177 --token "sk-actiondock-secret"
```

### 单包项目模式（在包项目目录内）
在包含 `actiondock.json` 的项目目录内运行：

```bash
cd examples/github-tools
ad serve --host 0.0.0.0 --port 8080 --token "sk-actiondock-secret"
```

### 跨目录指定路径
无需切换目录，在任意路径通过 `-d, --dir` 参数指定目标包目录：

```bash
ad serve -d ./examples/github-tools --host 0.0.0.0 --port 8080 --token "sk-actiondock-secret"
```

---

## 网络监听与安全防御机制

- 非回环地址强制令牌认证：默认 `--host 127.0.0.1` 仅允许本机回环访问。当监听在非回环地址（如 `--host 0.0.0.0` 或服务器公网与局域网 IP）供远程调度时，执行引擎强制要求传入 `--token`（或通过环境变量 `ACTIONDOCK_TOKEN` 注入），未配置鉴权凭证将直接拒绝启动。
- 防时序攻击校验：内置基于常数时间对比的令牌校验，彻底阻断旁路分析。
- 请求体大小防护：默认限制单个 JSON 请求体上限为 1MB（可通过 `--max-body 10mb` 调整），超限直接返回 413 状态码。
- 跨域资源共享策略：默认关闭跨域，可通过 `--cors-origin <origin>` 显式添加白名单源。
- 敏感信息自动脱敏：在配置查询接口中，被标记为密码、密钥等敏感字段的配置内容默认以掩码遮蔽，杜绝数据泄露。

---

## 标准 RESTful API 调度规范

所有受保护接口均支持通过请求头 `Authorization: Bearer <token>` 或 URL 查询参数 `?token=<token>` 进行身份鉴权。

ActionDock 2.0 统一采用 `/api/v2/` 路由前缀（兼容根路径路由）。

---

### 系统健康探查 (`GET /api/v2/health`)

用于容器健康探针与负载均衡存活检测（无需鉴权）：

```bash
curl http://localhost:5177/api/v2/health
```

响应数据：
```json
{
  "status": "ok",
  "version": "2.0.12",
  "timestamp": "2026-09-10T08:00:00.000Z",
  "uptime": 12.34
}
```

---

### 全局能力自省与包列表 (`GET /api/v2/info` 与 `GET /api/v2/packages`)

支持全局能力大纲、包层级下钻、模糊意图探索与拓扑树形查询。

```bash
# 获取全量自省信息
curl http://localhost:5177/api/v2/info \
  -H "Authorization: Bearer sk-actiondock-secret"

# 意图探索与模糊检索
curl "http://localhost:5177/api/v2/info?intent=github" \
  -H "Authorization: Bearer sk-actiondock-secret"

# 获取已加载包清单
curl http://localhost:5177/api/v2/packages \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### Action 发现与详情查询

```bash
# 列出所有可用 Action 清单
curl http://localhost:5177/api/v2/actions \
  -H "Authorization: Bearer sk-actiondock-secret"

# 查询特定 Action 契约定义与模式规范
curl http://localhost:5177/api/v2/actions/github.list-prs \
  -H "Authorization: Bearer sk-actiondock-secret"

# 多包环境下查询指定包内的 Action 详情
curl http://localhost:5177/api/v2/packages/team4u.github-tools/actions/github.list-prs \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### Action 执行与调度

ActionDock 2.0 支持同步阻塞执行与异步后台启动两种模式：

#### 同步执行 (`POST /api/v2/actions/:actionId/run`)

直接执行目标 Action，执行完毕后返回完整的标准执行信封：

```bash
curl -X POST http://localhost:5177/api/v2/actions/github.list-prs/run \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "repo": "team4u/actiondock" }
  }'
```

响应状态码：成功返回 200，校验失败返回 422，运行时错误返回 500。响应结构体保持不变：
```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "items": []
  }
}
```

#### 多包模式同步执行 (`POST /api/v2/packages/:packageId/actions/:actionId/run`)

```bash
curl -X POST http://localhost:5177/api/v2/packages/team4u.github-tools/actions/github.list-prs/run \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "repo": "team4u/actiondock" }
  }'
```

#### 异步启动与票据返回 (`POST /api/v2/actions/:actionId/start`)

针对长耗时任务，使用异步启动接口。服务端立即返回 202 Accepted 与执行票据，并在后台继续执行：

```bash
curl -X POST http://localhost:5177/api/v2/actions/github.list-prs/start \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "repo": "team4u/actiondock" }
  }'
```

响应数据：
```json
{
  "ok": true,
  "runId": "01JMB394...",
  "streamUrl": "/api/v2/runs/01JMB394.../events"
}
```

---

### 执行记录追溯、取消与事件流

```bash
# 查询执行历史记录列表
curl http://localhost:5177/api/v2/runs \
  -H "Authorization: Bearer sk-actiondock-secret"

# 查询单次执行详情
curl http://localhost:5177/api/v2/runs/01JMB394... \
  -H "Authorization: Bearer sk-actiondock-secret"

# 取消正在执行的任务
curl -X POST http://localhost:5177/api/v2/runs/01JMB394.../cancel \
  -H "Authorization: Bearer sk-actiondock-secret" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "用户手动中止" }'

# 订阅执行事件流（Server-Sent Events）
curl -N http://localhost:5177/api/v2/runs/01JMB394.../events \
  -H "Authorization: Bearer sk-actiondock-secret"
```

#### 事件断点续传与背压处理
- 事件流使用 Server-Sent Events 标准的 `id` 承载事件序号，支持通过请求头 `Last-Event-ID` 进行断点续传。
- 若游标已过期被清理，服务端返回 HTTP 410 与 `EVENT_CURSOR_EXPIRED` 错误。
- 若订阅端消费过慢导致队列溢出，服务端推送带有 `EVENT_BACKPRESSURE_LIMIT` 错误码的末尾事件并关闭连接。

---

### Playbook 规程查询

```bash
# 列出可用规程清单
curl http://localhost:5177/api/v2/playbooks \
  -H "Authorization: Bearer sk-actiondock-secret"

# 查看规程详情
curl http://localhost:5177/api/v2/playbooks/review-pr \
  -H "Authorization: Bearer sk-actiondock-secret"
```

---

### 环境体检诊断 (`GET /api/v2/doctor`)

```bash
curl http://localhost:5177/api/v2/doctor \
  -H "Authorization: Bearer sk-actiondock-secret"
```
