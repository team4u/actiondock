# 参考手册：错误代码与排错速查

ActionDock 采用确定性的结构化错误体系。所有失败均通过标准 JSON 信封输出，附带机器可解析的结构化错误代码与上下文明细。

---

## 错误信封结构

```json
{
  "ok": false,
  "runId": "01JMB394...",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Input validation failed: at '/name' must be string",
    "details": [
      {
        "instancePath": "/name",
        "message": "must be string"
      }
    ]
  }
}
```

---

## 结构化错误代码全量分类

### 参数与数据校验

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `INPUT_NOT_JSON` | 400 | 输入参数包含非有限数（NaN 或 Infinity）、循环引用、undefined、函数或符号等非标准 JSON 结构。在创建运行前直接拒绝。 | 检查调用入参数据，确保传递标准 JSON 兼容的纯数据结构。 |
| `OUTPUT_NOT_JSON` | 500 | Action 业务执行返回值包含非有限数、循环引用、undefined 或无法序列化的非 JSON 结构。 | 检查 Action 的 run 方法返回值，确保仅返回符合 JSON 规范的纯数据。 |
| `INPUT_VALIDATION_FAILED` | 400 | 传入的参数违反了 Action 声明的 inputSchema 约束（缺少必填属性、类型不匹配、包含多余未声明字段等）。 | 执行 `ad describe <id>` 查看字段模式规范，修正传参。 |
| `OUTPUT_VALIDATION_FAILED` | 500 | Action 业务返回值违反了清单中声明的 outputSchema 约束。 | 检查 Action 实现代码，确保返回值完全符合输出模式定义。 |

---

### 包、模块与动作解析

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `ACTION_NOT_FOUND` | 404 | 指定的 Action 标识在当前包、链接包或注册表中均未命中。 | 执行 `ad list` 确认动作标识是否存在或检查拼写。 |
| `PACKAGE_NOT_FOUND` | 404 | 请求中指定的包标识符无法在当前工作区、已链接包或注册表中定位。 | 确认包标识符拼写，或执行 `ad link` 挂载对应包。 |
| `ACTION_LOAD_FAILED` | 500 | Action 源码入口模块加载失败（模块缺失、语法错误或依赖未安装）。 | 检查入口文件路径与 TypeScript 语法，并在包目录下执行依赖安装。 |
| `ACTION_PACKAGE_VERSION_CONFLICT` | 409 | 依赖图中检测到相同包标识但存在不兼容的版本冲突。 | 检查 `actiondock.lock.json` 与依赖版本声明，消除多版本冲突。 |

---

### 执行调度与并发控制

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `ACTION_FAILED` | 500 | Action 内部业务逻辑抛出未分类异常。 | 检查 Action 业务代码与错误堆栈。 |
| `EXECUTION_FAILED` | 500 | 运行以失败状态终结且缺少结构化错误明细。 | 查看服务日志与底层执行信封。 |
| `UNHANDLED_EXECUTION_ERROR` | 500 | 执行调度器外层捕获到非预期的未处理异常。 | 检查宿主运行环境与系统资源。 |
| `ACTION_TIMEOUT` | 504 | Action 执行耗时超过了设定的超时阈值。 | 优化底层耗时操作，或在调用时通过 `--timeout` 调大超时时间。 |
| `ACTION_CANCELLED` | 499 / 500 | Action 执行被客户端取消信号主动中断。 | 确认取消意图，若非主动取消请检查网络或调用方超时配置。 |
| `EXECUTION_ABORTED` | 400 | 调用在真正启动执行前已被中止信号取消。 | 检查请求发起时的取消信号时序。 |
| `ACTION_SUBRUN_LIMIT` | 429 | 单个根任务发起的并发子任务数超出配额上限（上限为 16）。附带 `details.alias: "MAX_SUBRUNS_REACHED"` 标记。 | 检查级联调用规模，避免无节制并发派生过多子任务。 |
| `ACTION_CALL_CYCLE` | 508 | Action 级联调用检测到成环（如 A 调用 B，B 又调用 A）或超出调用深度上限。附带 `details.alias: "ACTION_CYCLE_DETECTED"` 或 `ACTION_MAX_DEPTH_EXCEEDED` 标记。 | 检查 Action 级联逻辑，消除相互循环调用或深层递归。 |
| `INVALID_ACTION_REF` | 400 | Action 引用格式非法；多包环境下短 ID 冲突存在歧义；或向 `ctx.actions.invoke` 传入了函数或非规范对象。 | 检查引用标识拼写；多包时使用完整标识符；仅传入字符串标识或规范引用。 |
| `UNDECLARED_ACTION_DEPENDENCY` | 403 | 尝试直接调用传递包内部动作，或级联调用未在 `actiondock.json` 的 `uses` 中显式声明的目标动作。 | 在 `actiondock.json` 中添加直接依赖或在 `uses` 列表中补充声明。 |
| `IDEMPOTENCY_CONFLICT` | 409 | 携带相同 requestId 的重放请求提交了不同的入参内容摘要。 | 确保相同去重请求标识对应相同的业务入参，或更换新的 requestId。 |
| `STANDALONE_ASYNC_UNSUPPORTED` | 400 | 独立单执行交付产物拒绝异步启动语义。 | 独立交付产物仅支持同步单次运行，异步任务请通过服务模式调用。 |
| `HOST_PROCESS_EXITED` | 502 | 宿主子进程已异常退出，调用无法送达。 | 检查子进程崩溃日志与系统资源。 |

---

### 存储、项目状态与锁控制

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `RUN_REPOSITORY_UNAVAILABLE` | 503 | 运行记录仓储服务不可用，底层存储尚未初始化或已关闭。 | 确认宿主实例是否正常启动或数据目录是否具备读写权限。 |
| `RUN_PERSISTENCE_FAILED` | 500 | 运行记录初始事务或终态事务写入存储失败。 | 检查磁盘剩余空间与 SQLite 数据库文件权限。 |
| `STORAGE_WORKER_EXITED` | 500 | SQLite 存储工作线程异常退出。 | 检查存储驱动异常日志并重启服务。 |
| `STORAGE_BUSY` | 503 | 数据库写入事务重试耗尽，底层 SQLite 锁等待超时。 | 降低并发写入压力或排查长时间占用事务。 |
| `PROJECT_BUSY` | 409 | 工程事务排他锁被另一个活跃的主机进程持有，拒绝并发启动。 | 避免并发操作同一项目目录，或终止旧的活跃进程。 |
| `PROJECT_RECOVERY_REQUIRED` | 409 | 前序主进程已退出，但残留受管子进程仍在后台运行，需先回收子进程方可接管数据目录。 | 清理残留孤儿进程或执行恢复流程后再行启动。 |
| `STATE_KEY_NOT_FOUND` | 404 | 查询的状态键不存在。 | 检查状态键命名空间与键名是否正确写入。 |

---

### 事件流与消息推送

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `EVENT_BACKPRESSURE_LIMIT` | 429 | 事件流订阅者消费过慢导致队列溢出，订阅连接被主动切断。 | 提升订阅端消费处理速度，使用最新可用游标重新连接。 |
| `EVENT_CURSOR_EXPIRED` | 410 | 订阅请求传入的事件游标已超过保留期限被清理。 | 客户端应从最新游标或当前状态重新同步。 |

---

### 子进程执行管控

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `PROCESS_OUTPUT_LIMIT` | 500 | 子进程输出累计字节数超过安全上限（默认 10MB）。 | 优化外部命令输出量或增加流式过滤处理。 |
| `PROCESS_SPAWN_ERROR` | 500 | 外部子进程派生启动失败（命令不存在或系统无执行权限）。 | 确认系统命令路径与可执行权限。 |
| `PROCESS_CANCELLED` | 500 | 子进程在执行中被 AbortSignal 信号取消。 | 检查任务是否触发了超时或上层主动取消。 |
| `PROCESS_TIMEOUT` | 504 | 外部命令执行耗时超出设定的超时限制。 | 优化命令执行逻辑或调大命令执行超时配置。 |

---

### 网络、鉴权与通用服务

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `UNAUTHORIZED` | 401 | 访问受保护的 HTTP 服务时未提供有效令牌。 | 检查请求头 Authorization: Bearer 配置。 |
| `NOT_FOUND` | 404 | 请求的 HTTP 路由端点不存在。 | 检查请求路径与 API 版本映射。 |
| `SERVER_ERROR` | 500 | HTTP 服务内部未捕获的常规错误。 | 检查服务端日志排查详细异常。 |
| `TIMEOUT` | 504 | 远程网络调用等待服务端响应超时。 | 检查网络连通性或调大远程客户端超时。 |
| `NETWORK_ERROR` | 502 | 无法与远程服务建立网络连接。 | 检查服务端监听地址、端口与网络连通性。 |
| `CAPABILITY_UNAVAILABLE` | 409 | 请求了目标服务未启用或不支持的能力。 | 检查服务端能力声明与调用模式。 |
