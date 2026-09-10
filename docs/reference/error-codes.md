# 参考手册：错误代码与排错速查

ActionDock 采用确定性的结构化错误体系。所有失败均通过标准 JSON 信封输出，附带机器可解析的结构化错误代码与上下文明细。

---

## 错误信封结构

```json
{
  "ok": false,
  "runId": "01JMB394...",
  "error": {
    "code": "INPUT_NOT_JSON",
    "message": "Input validation failed: Number is non-finite or NaN",
    "details": {
      "reason": "Number is non-finite or NaN"
    }
  }
}
```

---

## 结构化错误代码全量分类

### JSON 与参数校验

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `INPUT_NOT_JSON` | 400 | 输入参数包含非有限数（NaN 或 Infinity）、循环引用、undefined、bigint、函数或符号等非标准 JSON 结构。在创建运行前直接拒绝。 | 检查调用入参数据，确保传递标准 JSON 兼容的数值与结构对象。 |
| `OUTPUT_NOT_JSON` | 500 | Action 业务执行返回值包含非有限数、循环引用、undefined 或无法序列化的非 JSON 结构。 | 检查 Action 的 run 方法返回值，确保仅返回符合 JSON 规范的纯数据。 |
| `ACTION_INPUT_INVALID` | 422 | 传入的参数违反了 Action 声明的 inputSchema 约束（缺少必填属性、类型不匹配等）。 | 执行 `ad describe <id>` 查看字段约束，修正调用传参。 |
| `ACTION_OUTPUT_INVALID` | 500 | Action 业务返回值违反了声明的 outputSchema 约束。 | 检查 Action 实现代码，确保返回值结构符合契约定义。 |
| `INPUT_VALIDATION_FAILED` | 422 | 输入模式校验失败的兼容别名代码。 | 参考 `ACTION_INPUT_INVALID` 建议。 |
| `OUTPUT_VALIDATION_FAILED` | 500 | 输出模式校验失败的兼容别名代码。 | 参考 `ACTION_OUTPUT_INVALID` 建议。 |

---

### 调度与并发控制

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `ACTION_SUBRUN_LIMIT` | 429 | 单个根任务的活跃子任务数或累计子任务总数超出了宿主配额上限。 | 检查级联调用规模，避免无节制并发派生过多子任务。 |
| `ACTION_CALL_CYCLE` | 508 | 级联调用检测到相互调用成环（如 A 调用 B，B 又调用 A）或超出调用深度上限。 | 检查 Action 级联逻辑，消除相互循环调用或深层嵌套递归。 |
| `INVALID_ACTION_REF` | 400 | Action 引用格式非法；多包环境下短 ID 冲突存在歧义；或向 `ctx.actions.invoke` 传入了动作定义对象或裸函数。 | 检查引用标识拼写；多包时使用完全限定标识符；调用 invoke 时仅传入字符串 ID 或 ActionRef。 |
| `UNDECLARED_ACTION_DEPENDENCY` | 403 | 尝试根调用未声明的传递包动作，或级联调用未在 `actiondock.json` 的 `uses` 中声明的目标 Action。 | 在 `actiondock.json` 中添加直接依赖或在 `uses` 字段中显式声明该 Action。 |
| `ACTION_NOT_FOUND` | 404 | 指定的 Action 标识在当前包或注册表中不存在。 | 执行 `ad list` 确认动作标识是否存在或拼写正确。 |
| `PACKAGE_NOT_FOUND` | 404 | 请求中指定的包标识符无法在当前工作区或注册表中定位。 | 确认包标识符拼写，或执行 `ad link` 挂载对应包。 |
| `ACTION_LOAD_FAILED` | 500 | Action 源码入口模块加载失败（语法错误或依赖缺失）。 | 检查入口文件路径与 TypeScript 语法，并在包目录下执行依赖安装。 |
| `ACTION_TIMEOUT` | 504 | Action 执行耗时超过了设定的超时阈值。 | 优化底层耗时操作，或在调用时通过 `--timeout` 调大超时时间。 |

---

### 存储与持久化

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `RUN_REPOSITORY_UNAVAILABLE` | 503 | 运行记录仓储服务不可用，底层存储连接尚未初始化或已关闭。 | 确认 Host 实例是否正常启动或数据目录是否可访问。 |
| `RUN_PERSISTENCE_FAILED` | 500 | 运行记录初始事务或终态事务写入存储失败。 | 检查磁盘空间与 SQLite 数据库文件读写权限。 |
| `STORAGE_WORKER_EXITED` | 500 | SQLite 存储工作线程异常退出，无法继续处理读写请求。 | 检查存储驱动异常日志，重启宿主进程。 |
| `DATA_DIR_IN_USE` | 409 | 数据目录已被另一个活跃的 Host 进程（记录有活跃 PID）锁定占用，拒绝并发启动。 | 避免并发使用同一数据目录，或停止冲突的旧进程。 |
| `DATA_DIR_RECOVERY_REQUIRED` | 409 | 前序 Host 主进程已退出，但其残留子进程仍在运行，需先回收子进程方可接管数据目录。 | 清理未退出的残留子进程后再行启动。 |
| `STORAGE_BUSY` | 503 | 数据库写入事务重试耗尽，底层 SQLite 忙等待超时。 | 降低并发写入压力或检查是否存在长事务锁表。 |
| `STORAGE_ERROR` | 500 | 底层数据库操作发生未捕获的存储异常。 | 检查数据库完整性与文件权限。 |

---

### 执行去重与事件流

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `IDEMPOTENCY_CONFLICT` | 409 | 携带相同 requestId 的去重重放请求提交了不同的输入参数内容摘要。 | 确保相同去重请求标识对应相同的业务入参，或更换新的 requestId。 |
| `EVENT_BACKPRESSURE_LIMIT` | 429 | 事件流订阅者消费过慢导致队列溢出，订阅连接被主动切断。 | 提升订阅端消费处理速度，使用游标重新建立连接。 |
| `EVENT_CURSOR_EXPIRED` | 410 | 订阅请求传入的事件游标早已超过保留期限被修剪清理。 | 客户端应重新从最新可用游标或当前全量状态重新同步。 |

---

### 调用门面与协议

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `TARGET_PROTOCOL_UNSUPPORTED` | 400 | 客户端与服务端通信协议主版本不兼容。 | 升级客户端或服务端版本保持一致。 |
| `TARGET_CAPABILITY_UNAVAILABLE` | 409 | 请求了目标宿主未声明或未启用的能力特性（如在不支持异步的独立单次进程中请求异步任务）。 | 检查目标服务支持的能力清单，使用匹配的调用模式。 |
| `TARGET_RESULT_UNKNOWN` | 502 | 远程服务返回了无法解析的非标准响应或网络中断导致执行状态未定。 | 检查网络连通性及远程服务端日志。 |
| `CloseTimeoutError` | 500 | 关闭宿主或 Target 实例时，等待未结束运行收尾超过宽限期。 | 检查是否有未响应取消信号的长时间占用任务。 |
| `UNAUTHORIZED` | 401 | 访问受保护的 HTTP 或网络服务时未提供有效令牌。 | 检查请求头中的身份令牌配置。 |
| `FORBIDDEN` | 403 | 非回环地址请求鉴权失败或权限范围不足。 | 配置正确的访问令牌与管理权限。 |

---

### 构建与打包

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `UNSUPPORTED_BUILD_MODE` | 400 | 在 `ad build` 或 `ad export skill` 中传入了已废弃的选项（如 `--target`、`--bytecode` 或 `--standalone`）。 | 移除废弃参数，使用标准的 Node.js 目录构建或 `--mode node` 模式。 |
