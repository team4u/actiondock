# 参考手册：错误代码与排错速查

ActionDock 采用确定性的结构化错误体系。HTTP 接口与 CLI 的 `--json` 模式使用标准 JSON 信封，附带错误代码与明细。CLI 纯文本模式将错误写入 stderr。

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
| `INPUT_NOT_JSON` | 400 | 输入参数包含非有限数、循环引用、函数等非标准 JSON 结构。在启动执行前直接拒绝。 | 校验调用入参数据，确保传递标准 JSON 兼容的纯数据结构。 |
| `OUTPUT_NOT_JSON` | 500 | Action 业务执行返回值包含非有限数、循环引用等非 JSON 结构。 | 校验 Action 的 run 方法返回值，确保仅返回符合 JSON 规范的纯数据。 |
| `INPUT_VALIDATION_FAILED` | 400 | 传入参数违反 inputSchema 约束（缺少必填属性、类型不匹配等）。 | 执行 `ad describe <id>` 查看字段模式规范，修正传参。 |
| `OUTPUT_VALIDATION_FAILED` | 500 | Action 业务返回值违反 outputSchema 约束。 | 校验 Action 实现代码，确保返回值完全符合输出模式定义。 |
| `INVALID_FLAT_ARGUMENT` | 400 | 扁平赋值参数语法非法。例如缺少操作符、路径为空或包含敏感属性。 | 校验扁平赋值表达式。确保符合 `path=value` 或 `path:=json` 格式。 |
| `INVALID_JSON_LITERAL` | 400 | 使用 `:=` 赋值时，右侧值非合法 JSON 字面量，或包含非有限数。 | 校验 `:=` 后的 JSON 文本。确保为合法 JSON 且数值有限。普通字符串使用 `=` 赋值。 |
| `INPUT_PATH_CONFLICT` | 400 | 扁平赋值表达式物化时发生路径冲突。例如叶节点与容器冲突或重复赋值。 | 校验各赋值项的路径前缀与类型。确保数组索引连续且容器与标量无冲突。 |
| `FLAT_INPUT_LIMIT_EXCEEDED` | 400 | 扁平赋值超出限制，或最终入参大小超过默认 10MiB 上限。 | 缩减或分批处理输入。改用文件不解除输入大小限制。 |
| `INPUT_CONFLICT` | 400 | 扁平参数与 `--input` 或 `--input-file` 混用。 | 三种输入方式仅选其一。原始文本绑定可与扁平参数组合。 |
| `CONFIG_VALUE_INVALID` | 400 | 传入的配置值未能通过模式校验。系统在错误明细中不携带敏感输入值。 | 执行 `ad config schema` 确认配置项模式约束，修正传入的值。系统不支持部分更新。 |

---

### 命令行输入与正文展示

下列错误在本地输入解析或 CLI 展示阶段产生，不改变远端 HTTP 执行契约：

- `INVALID_FLAT_ARGUMENT`：用于拒绝非法 `--stdin-field` 字段名。字段名对应入参。
- `INPUT_PATH_CONFLICT`：用于拒绝扁平参数与输入绑定字段的冲突。在读取正文前报告。
- `INPUT_LIMIT_EXCEEDED`：输入源字节超过 10MiB 上限。与最终入参大小上限独立生效。
- `INPUT_FILE_READ_FAILED`：输入读取失败。文本含非法 UTF-8 时，错误原因为 `INVALID_UTF8`。
- `INVALID_ANNOTATION`：CLI 同步调用发现正文注解非法时拒绝执行。修正清单并执行 `ad validate`。`--json` 选项可绕过默认注解。
- `OUTPUT_FORMAT_ERROR`：实际结果不是对象或非字符串，CLI 无法提取正文。执行记录可能已成功。可从执行记录读取完整结果。

---

### 包、模块与动作解析

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `ACTION_NOT_FOUND` | 404 | 指定的 Action 标识在当前包、链接包或注册表中均未命中。 | 执行 `ad list` 确认动作标识是否存在，并校验拼写。 |
| `PACKAGE_NOT_FOUND` | 404 | 请求中指定的包标识符无法在当前工作区或注册表中定位。 | 校验包标识符拼写，或执行 `ad link` 挂载对应包。 |
| `PACKAGE_ID_CONFLICT` | - | 本次加载范围内，同一完整包 ID 对应多个真实目录。同短名不同完整 ID 不冲突。 | CLI 以退出码 1 拒绝。使用 `ad doctor` 查看来源并解除多余包。冲突时按路径仍可 `unlink`。常驻宿主需重启以加载修复后的包。 |
| `PACKAGE_NOT_ALLOWED` | 403 | 目标包未列入微服务启动白名单（`-P, --package`）或访问控制规则拒绝访问。 | 确认服务启动时传入的 `-P` 参数包含该包，或调整调用的包名称。 |
| `ACTION_FORBIDDEN` | 403 | 目标动作未列入微服务启动白名单（`-A, --action`）或访问控制规则拒绝访问。 | 确认服务启动时传入的 `-A` 参数包含该动作，或调整调用的动作标识。 |
| `ACTION_LOAD_FAILED` | 500 | Action 源码入口模块加载失败。例如模块缺失、语法错误或依赖未安装。 | 校验入口文件路径与 TypeScript 语法，并在包目录下执行依赖安装。 |
| `DEPENDENCIES_NOT_READY` | - | 本地准备使用：必需生产依赖未物化且禁止自动首装，或已有 node_modules 损坏。 | 校验依赖声明。若使用了 `--no-install` 说明禁止自动安装。按对应包管理器执行安装修复。 |
| `DEPENDENCY_INSTALL_FAILED` | - | 本地准备使用：依赖自动安装子进程启动失败、超时或退出码错误。 | 校验安装根目录的包管理器配置与锁文件，排查具体错误输出。 |
| `ACTION_PACKAGE_VERSION_CONFLICT` | 409 | 依赖图中检测到相同包标识但存在不兼容的版本冲突。 | 校验 `actiondock.lock.json` 与版本声明，消除多版本冲突。 |

---

### 执行调度与并发控制

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `ACTION_FAILED` | 500 | Action 内部业务逻辑抛出未分类错误。 | 校验 Action 业务代码与错误堆栈。 |
| `EXECUTION_FAILED` | 500 | 执行以失败状态终结且缺少结构化错误明细。 | 查看服务日志与底层执行信封。 |
| `UNHANDLED_EXECUTION_ERROR` | 500 | 执行调度器外层捕获到非预期的未处理错误。 | 校验宿主执行环境与系统资源。 |
| `ACTION_TIMEOUT` | 504 | Action 执行耗时超过了配置的超时阈值。本地 `ad run` 预算覆盖前置准备与动作执行。 | 优化底层耗时操作，或在调用时通过 `--timeout` 调大超时时间。 |
| `ACTION_CANCELLED` | 499 / 500 | 客户端取消信号主动中断了 Action 执行。 | 确认取消意图。若非主动取消请校验网络或调用方超时配置。 |
| `EXECUTION_ABORTED` | 400 | 中止信号在真正启动执行前取消了调用。 | 校验请求发起时的取消信号时序。 |
| `ACTION_SUBRUN_LIMIT` | 429 | 单个根任务发起的并发子任务数超出配额上限（默认 64）。附带 `MAX_SUBRUNS_REACHED` 标记。 | 校验级联调用规模，避免无节制并发派生过多子任务。 |
| `ACTION_CALL_CYCLE` | 508 | Action 级联调用检测到成环或超出调用深度上限。附带 `ACTION_CYCLE_DETECTED` 标记。 | 校验 Action 级联逻辑，消除相互循环调用或深层递归。 |
| `INVALID_ACTION_REF` | 400 | Action 引用格式非法，或向 `ctx.actions.invoke` 传入了函数或非规范对象。 | 校验引用标识拼写。多包时使用完整标识符。仅传入字符串或规范引用。 |
| `UNDECLARED_ACTION_DEPENDENCY` | 403 | 尝试调用传递包内部动作，或级联调用未在 `uses` 中声明的目标动作。 | 在 `actiondock.json` 中添加直接依赖或在 `uses` 列表中补充声明。 |
| `IDEMPOTENCY_CONFLICT` | 409 | 携带相同 requestId 的重放请求提交了不同的输入、配置或原始时限。 | 保持相同去重请求对应的输入与配置一致，或使用新的 requestId。 |
| `STANDALONE_ASYNC_UNSUPPORTED` | 400 | 独立单执行交付产物拒绝异步启动语义。 | 独立交付产物仅支持同步单次执行。异步任务请通过服务模式调用。 |
| `HOST_PROCESS_EXITED` | 502 | 宿主子进程已退出，调用无法送达。 | 校验子进程崩溃日志与系统资源。 |
| `HOST_LOST` | - | 仅用于 `ad runs watch`：本地观察中确认执行记录的宿主进程已退出。 | 任务宿主已崩溃，请重新派工。该代码出现在 watch 输出的 `error` 字段中。 |
| `WATCH_QUERY_FAILED` | - | 仅用于 `ad runs watch`：执行记录查询连续失败达到容忍阈值。 | 校验本地数据库或远端服务连通性后重试。该代码出现在 watch 的 `error` 字段中。 |

---

### 存储、项目状态与锁控制

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `RUN_REPOSITORY_UNAVAILABLE` | 503 | 执行记录存储服务不可用，底层存储尚未初始化或已关闭。 | 确认宿主实例是否正常启动或数据目录是否具备读写权限。 |
| `RUN_PERSISTENCE_FAILED` | 500 | 执行记录初始事务或终态事务写入存储失败。 | 校验磁盘剩余空间与 SQLite 数据库文件权限。 |
| `STORAGE_BUSY` | 503 | 数据库写入事务重试耗尽，底层 SQLite 锁等待超时。 | 降低并发写入压力或排查长时间占用事务。 |
| `PROJECT_BUSY` | 409 | 另一个活跃的主机进程持有工程事务排他锁，拒绝并发启动。 | 避免并发操作同一项目目录，或终止旧的活跃进程。 |
| `PROJECT_RECOVERY_REQUIRED` | 409 | 工程存在未恢复的依赖事务，或恢复安装失败。未恢复前不能开启新事务。 | 通过 `ad add`、`ad remove` 或本地 `ad run` 完成恢复。排查具体错误并保留快照。 |
| `STATE_KEY_NOT_FOUND` | 404 | 查询的状态键不存在。 | 校验状态键命名空间与键名是否正确写入。 |

---

### 事件流与消息推送

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `EVENT_BACKPRESSURE_LIMIT` | 429 | 消费过慢导致队列溢出，服务端主动切断订阅连接。 | 提升订阅端消费处理速度，使用最新可用游标重新连接。 |
| `EVENT_CURSOR_EXPIRED` | 410 | 订阅请求传入的事件游标已超过保留期限，系统已清理该游标。 | 客户端应从最新游标或当前状态重新同步。 |

---

### 子进程执行管控

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `PROCESS_OUTPUT_LIMIT` | 500 | 子进程输出累计字节数超过安全上限（默认 10MB）。 | 优化外部命令输出量或增加流式过滤处理。 |
| `PROCESS_SPAWN_ERROR` | 500 | 外部子进程派生启动失败（命令不存在或系统无执行权限）。 | 校验系统命令路径与可执行权限。 |
| `PROCESS_CANCELLED` | 500 | AbortSignal 信号在执行中取消了子进程。 | 校验任务是否触发了超时或上层主动取消。 |
| `PROCESS_TIMEOUT` | 504 | 外部命令执行超过时限，或终止后未在清理期限内退出。 | 校验错误详情并区分超时类型。优化命令或调整执行时限。 |

---

### 网络、鉴权与通用服务

| 错误代码 | HTTP 状态码 | 产生原因 | 排查与修复建议 |
| :--- | :---: | :--- | :--- |
| `UNAUTHORIZED` | 401 | 访问受保护的 HTTP 服务时未提供有效令牌。 | 校验请求头 Authorization: Bearer 配置。 |
| `NOT_FOUND` | 404 | 请求的 HTTP 路由端点不存在。 | 校验请求路径与 API 版本映射。 |
| `SERVER_ERROR` | 500 | HTTP 服务内部未捕获的常规错误。 | 校验服务端日志排查详细错误。 |
| `TIMEOUT` | 504 | 远程网络调用等待服务端响应超时。 | 校验网络连通性或调大远程客户端超时。 |
| `NETWORK_ERROR` | 502 | 无法连接远程服务。 | 校验服务端监听地址、端口与网络连通性。 |
| `CAPABILITY_UNAVAILABLE` | 409 | 请求了目标服务未启用或不支持的能力。 | 校验服务端能力声明与调用模式。 |
