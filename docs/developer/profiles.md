# 实践指南：多环境 Profile 与远程调度

Profile 多环境配置机制允许开发者在本地终端中无缝管理多个远端 ActionDock 服务节点，实现跨开发、测试与生产环境的灵活调度。

---

## 目标解析五级优先级机制

当执行 Action 或查询包能力时，ActionDock 按照确定的五级优先级判定执行目标与拓扑定位：

- **命令行显式参数**：最高优先级。通过 `--server`、`--token` 或 `--profile` 直接指定的远端端点与凭证。
- **Profile 配置**：当前激活的默认 Profile（存储于 `~/.actiondock/profiles.json`）或通过 `--profile <name>` 显式选定的环境配置。
- **环境变量**：操作系统环境变量（`ACTIONDOCK_SERVER`、`ACTIONDOCK_TOKEN`、`ACTIONDOCK_PROFILE`）。
- **本地工程清单**：当前工作目录或父级目录中存在的 `actiondock.json` 工程。
- **全局注册表**：通过 `ad link` 挂载并登记在全局路由表（`~/.actiondock/registry.json`）中的外部包资产。

---

## Profile 管理命令

### 添加远程 Profile

```bash
# 使用固定 Token
ad profile add staging --server http://10.0.0.12:8080 --token secret-token-123

# 使用环境变量引用（更安全，推荐）
ad profile add prod --server https://actiondock.internal.company.com --token-env PROD_ACTIONDOCK_TOKEN
```

### 查看与切换 Profile

```bash
# 列出所有配置的 Profile
ad profile list

# 设为默认 Profile
ad profile use staging

# 显式切换回本地执行环境
ad profile use local

# 查看指定 Profile 详情
ad profile show staging

# 连通性测试
ad profile test staging

# 删除 Profile
ad profile remove old-env
```

### `profile use local` 与本地发现优先级

- **本地环境重置**：当执行 `ad profile use local` 时，系统将默认执行目标切回本地环境，后续命令不再默认转发至远端节点。
- **本地目标发现优先级**：在本地模式下，能力检索与执行优先定位当前工作目录工程（以本地 `actiondock.json` 为准）；若当前工程未命中且指定了包标识，则回退检索全局路由表中已链接的外部包（以 `ad link` 注册路径为准）。

---

## 跨节点远程执行与异步追踪

在执行命令时传入 `--profile` 或 `--server` 参数，CLI 会自动将请求转发给远端 `ad serve` 节点执行：

```bash
# 在 staging 节点同步执行 Action
ad run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}' --profile staging

# 查询远程节点的健康状态与 Action 清单
ad info --profile prod
```

### 异步执行语义与后续链路

对于耗时较长的重型任务，可通过 `--async` 启用异步后台执行机制：

- **异步调度触发**：
  ```bash
  ad run heavy-data-sync --input-file ./params.json --profile prod --async
  ```
  远端节点立即接受调度并返回包含 `runId` 的初始化信封（例如 `{"ok": true, "runId": "01JMB394..."}`），客户端免于保持长连接阻塞等待。
- **执行状态查询与结果拉取**：
  通过 `ad runs show` 追踪任务生命周期，获取标准输出结果：
  ```bash
  ad runs show 01JMB394... --profile prod
  ```
- **主动任务取消**：
  若需中途终止正在执行的后台任务，调用取消命令：
  ```bash
  ad runs cancel 01JMB394... --profile prod --reason "手动中止任务"
  ```

---

## 运行形态对比分析

ActionDock 支持三种服务化与宿主接入运行形态，分别针对不同架构层次：

- HTTP 远程调度服务（`ad serve`）：
  - 核心协议：原生 RESTful JSON API。
  - 服务能力：提供完整的动作调度、参数校验、状态历史查询（`/runs`）、健康体检（`/health`）与异步任务生命周期管理。
  - 适用场景：团队共享的云端执行节点、持续集成自动化流水线调度端点、分布式任务集群。
- MCP HTTP 与 SSE 微服务（`ad mcp serve`）：
  - 核心协议：Model Context Protocol 规范（基于 HTTP POST 与 Server-Sent Events 流式传输）。
  - 服务能力：将包内声明的 Action 与 Playbook 自动化转换为标准 MCP 工具与提示词模板。
  - 适用场景：通过网络为远程 AI 智能体平台、低代码编排平台提供标准化的工具发现与调用接口。
- STDIO 管道运行形态（`ad mcp`）：
  - 核心协议：基于标准输入输出流（stdin 与 stdout）的 MCP JSON-RPC 协议。
  - 服务能力：无端口监听与网络暴露，零配置启动；诊断日志一律输出到 stderr，确保管道专供协议帧通信。
  - 适用场景：本地桌面智能体客户端、IDE 扩展插件或无网络权限沙箱内的直连集成。

---

## 安全加固保证

- **文件权限保护**：Profile 配置文件 `~/.actiondock/profiles.json` 写入时强制设置 `0o600` 文件权限（仅当前系统用户可读写）。
- **支持 tokenEnv 环境变量**：避免在配置文件中明文保存高权限敏感 Token。
