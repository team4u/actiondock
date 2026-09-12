# HTTP 微服务与 API 调度

当需要将 ActionDock 作为微服务部署，供远程 AI 智能体、持续集成流水线、自动化网关或外部前端系统通过网络调度时，可以使用 `ad serve` 启动轻量级 HTTP 服务。

服务端原生基于 Node.js 模块构建，提供能力自省、同步调用、异步任务生命周期管理以及实时事件流推送能力。

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

### 指定工程目录路径

无需切换工作目录，通过 `-d, --dir` 参数指定目标工程路径：

```bash
ad serve -d ./my-project --host 0.0.0.0 --port 5177 --token "sk-actiondock-secret"
```

---

## 安全机制与身份鉴权

- 非回环强制令牌鉴权：当 `--host` 设置为非回环地址（如 `0.0.0.0` 或物理网卡 IP）时，框架强制要求配置鉴权令牌（通过 `--token` 参数或环境变量 `ACTIONDOCK_TOKEN` 注入），否则服务端拒绝启动。
- 常数时间对比：内置常数时间比对算法验证请求令牌，防范时序侧信道攻击。
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

## 端点能力与接口总览

ActionDock HTTP 微服务提供了一整套标准端点：

| 能力分类 | 主要端点 | 核心用途 |
| :--- | :--- | :--- |
| **系统探针** | `GET /api/v2/health` | 容器健康探查与负载均衡存活检测（免鉴权） |
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

---

## 完整接口契约参考

关于完整的请求响应 JSON Schema、URL 参数、多包路由模式（`/packages/:pkg/actions/:id/...`）以及全量错误码定义，请参阅：

- [HTTP API 接口契约](../reference/http-api.md)
