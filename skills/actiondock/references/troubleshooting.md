# 参考手册：故障排查与自愈决策指南

> [!NOTE]
> 本手册仅供智能体或开发者在遇到明确调用异常或系统报错时定向检索，**正常流程中严禁前置运行排查命令**。

---

## 错误信封结构

ActionDock 所有失败均输出确定性的结构化错误信封：

```json
{
  "ok": false,
  "runId": "01JMB394...",
  "error": {
    "code": "ACTION_INPUT_INVALID",
    "message": "Input validation failed: 'repo' is required",
    "details": {
      "missing": ["repo"]
    }
  }
}
```

---

## 结构化错误代码排查与自愈决策表

### 参数与 JSON 校验

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `INVALID_JSON` | 输入内容不符合 JSON 语法规范（如单引号未转义、属性名未加双引号、空文件或空标准输入等）。 | 检查传入的 JSON 语法；复杂结构推荐先保存为独立文件并通过 `--input-file <path>` 传递。 |
| `INVALID_FLAT_ARGUMENT` | 扁平赋值语法错误、非法属性名或非法数组索引（如前导零、负数、科学计数法等）或包含原型污染敏感属性。 | 检查赋值语法，确保属性名符合 `[A-Za-z_][A-Za-z0-9_-]*`，数组索引为非负连续整数，杜绝 `__proto__` 等属性。 |
| `INVALID_JSON_LITERAL` | `path:=json` 中的 JSON 字面量解析失败或包含非有限数（`Infinity`、`-Infinity`、`NaN`）。 | 检查 `:=` 后的 JSON 语法是否合法，确保所有数值满足 `Number.isFinite`。 |
| `INPUT_PATH_CONFLICT` | 扁平参数路径冲突（叶节点/容器冲突、对象/数组冲突、重复路径赋值或非连续稀疏数组）。 | 检查路径层级与类型，确保数组索引从 0 开始连续编号，杜绝同名键重复赋值与结构覆盖冲突。 |
| `FLAT_INPUT_LIMIT_EXCEEDED` | 扁平参数数量、路径深度、路径长度、属性名长度或物化体积超出安全限制。 | 缩减参数规模；超大或深层数据改用 `--input-file <path>` 传递。 |
| `INPUT_CONFLICT` | 命令行同时混合指定了扁平参数（`-- <assignments...>`）、`--input` 或 `--input-file`。 | 仅保留其中一种输入模式，三者严格互斥；简单标量推荐使用扁平参数，复杂结构使用 `--input-file`。 |
| `INPUT_FILE_NOT_FOUND` | `--input-file` 指定的目标文件在文件系统中不存在。 | 检查文件物理路径是否准确，或改用标准输入管道 `--input-file -` 传递数据。 |
| `INPUT_FILE_READ_FAILED` | 读取输入文件或标准输入流发生底层错误（如目标为目录或权限不足）。 | 检查文件权限，确保指定的是有效可读文件而非目录。 |
| `INPUT_NOT_JSON` | 输入参数包含非有限数（NaN 或 Infinity）、循环引用或函数等非法类型。 | 检查调用参数，确保传递合法的纯 JSON 格式数据。推荐使用 `--input-file <path>` 传递。 |
| `OUTPUT_NOT_JSON` | Action 业务返回值包含不可序列化的非 JSON 结构。 | 检查 Action 代码返回值，剔除非有限数、循环引用或裸类实例。 |
| `ACTION_INPUT_INVALID` | 传入参数不匹配该 Action 声明的 inputSchema 契约。 | 执行 `ad describe <id>` 调阅参数定义与必填要求，修正传参字段与类型。 |
| `ACTION_OUTPUT_INVALID` | Action 返回的对象不匹配 outputSchema 模式定义。 | 检查 Action 实现代码，确保返回结构包含全部必须属性且类型一致。 |

---

### 调度与依赖链路

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `ACTION_NOT_FOUND` | 指定的动作标识不存在。 | 执行 `ad list` 确认当前项目或注册表中动作标识的拼写。 |
| `PACKAGE_NOT_FOUND` | 指定的包标识符无法在当前工作区或注册表中定位。 | 确认包标识符拼写；若为外部依赖包执行 `ad add <package>` 安装；若为本地未发布源码包执行 `ad link` 挂载。 |
| `PACKAGE_NOT_ALLOWED` | 目标包未列入服务端启动白名单。 | 确认服务端启动参数 `-P, --package` 是否包含该包标识，或调整调用的包名。 |
| `ACTION_FORBIDDEN` | 目标动作未列入服务端允许白名单。 | 确认服务端启动参数 `-A, --action` 是否包含该动作标识（短名或全限定名），或调整调用的动作名。 |
| `UNDECLARED_ACTION_DEPENDENCY` | 级联调用了未在清单 uses 列表中声明的目标 Action。 | 在调用方 `actiondock.json` 的对应 Action 下补全 `uses: ["<target-action>"]` 声明。 |
| `INVALID_ACTION_REF` | 跨包调用标识存在歧义，或向 invoke 传入了 Action 定义对象。 | 跨包调用使用完全限定标识符 `<pkg>/<action>`；确保 `invoke` 仅传入字符串标识符或 ActionRef 对象。 |
| `ACTION_CALL_CYCLE` | 级联调用发生循环调用或超深递归。 | 检查 Action 间的相互调用链路，消除闭环逻辑。 |
| `ACTION_SUBRUN_LIMIT` | 单个根任务派生的活跃子任务数超出配额限制。 | 优化业务编排逻辑，避免高并发派生大量子任务。 |
| `ACTION_TIMEOUT` | Action 执行时间超过了设定的超时阈值。 | 优化底层耗时操作，或在调用时添加 `--timeout 60s` 增大超时时间。 |
| `ACTION_LOAD_FAILED` | Action 源码入口模块加载失败（语法错误或依赖缺失）。 | 检查入口文件物理路径与 TypeScript 语法，并在包目录下执行依赖安装。 |
| `UNMET_LOCAL_DEPENDENCY` | Action 源码引用了未在 files 字段中声明的本地代码模块。 | 在 `actiondock.json` 中配置 `"files": ["<dir>"]`（例如 `"files": ["src"]`）。 |

---

### 存储与数据目录冲突

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `STORAGE_WORKER_EXITED` | SQLite 存储工作线程异常退出。 | 查看存储驱动异常日志，重启 Host 进程或重新触发命令。 |
| `DATA_DIR_IN_USE` | 数据目录已被另一个活跃进程（记录有活跃 PID）锁定占用。 | 停止冲突进程，或通过 `--data-dir <path>` 指定独立的存储目录。 |
| `DATA_DIR_RECOVERY_REQUIRED` | 前序主进程已退出，但其残留子进程仍在运行阻碍接管。 | 清理未退出的残留孤儿进程后再行启动。 |
| `RUN_REPOSITORY_UNAVAILABLE` | 运行记录仓储服务不可用，底层存储连接尚未初始化或已关闭。 | 确认 Host 实例是否正常启动，检查数据目录读写权限。 |
| `STORAGE_BUSY` | 数据库写入事务重试耗尽，底层 SQLite 忙等待超时。 | 降低并发写入压力或检查是否存在长事务占用。 |

---

### 协议与环境适配

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `TARGET_PROTOCOL_UNSUPPORTED` | 客户端与远程 Runner 服务的协议版本不匹配。 | 升级本地 CLI 或远程 ActionDock 服务版本保持一致。 |
| `TARGET_CAPABILITY_UNAVAILABLE` | 请求了目标宿主未启用的能力（如单次执行中请求异步任务）。 | 检查目标服务支持的能力清单，使用匹配的调用模式。 |
| `UNSUPPORTED_BUILD_MODE` | 传入了已废弃的编译选项（如 `--target`、`--bytecode`、`--standalone`）。 | 移除废弃参数，使用标准的 Node.js 目录构建或 `--mode node` 模式。 |
| `UNAUTHORIZED` | 访问受保护的 HTTP 或 MCP 服务时未提供有效令牌。 | 检查调用参数或请求头中的 `--token` 配置。 |
| `INSECURE_TRANSPORT` | 携带认证令牌向非本地回环的明文 HTTP 服务发起请求时被安全策略阻断。 | 推荐在服务端以 `--https` 启用安全传输；或在客户端通过 `-k, --insecure` 或 `--allow-insecure-http` 显式豁免。 |
| `TARGET_CLOSED` | 尝试在已显式调用过 close() 关闭的远程目标门面实例上调用操作方法。 | 检查目标门面的生命周期管理，确保在所有异步调用完成前不要提前调用关闭。 |

---

### 受管进程与系统命令

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `PROCESS_SPAWN_ERROR` | 外部系统命令派生失败，可执行程序不存在或缺少执行权限。 | 检查命令路径拼写与环境变量，确认可执行文件的执行权限。 |
| `PROCESS_TIMEOUT` | 外部命令执行耗时超出设定的超时阈值（`timeoutMs`）。 | 调优底层命令执行效率，或在调用时调大 `timeoutMs`。 |
| `PROCESS_OUTPUT_LIMIT` | 外部命令输出累计字节数超出设置的缓冲区上限（`maxOutputBytes`）。 | 增加流式过滤处理，或调大 `maxOutputBytes` 缓冲上限。 |
| `CONTROL_BUSY` | 尝试获取长期受管进程控制权时，令牌已被其他调用方持有且等待超时。 | 调大 `waitMs` 等待重试，或检查持有控制权的调用链路是否发生泄漏。 |
| `CONTROL_EXPIRED` | 长期进程控制令牌租约已超时过期。 | 检查长任务执行耗时，合理设置 `ttlMs` 并确保在业务链路中维持自动续租。 |
| `PROCESS_QUARANTINED` | 长期交互进程因异常控制失效、中断或脏状态已进入隔离终止状态。 | 捕获异常并排查进程崩溃原因，重新调用 `start` 启动新进程实例。 |
| `OUTPUT_GAP` | 环形输出缓冲区发生覆盖淘汰，且读取策略配置为报错阻断。 | 将读取策略调整为 `onGap: "skip"` 跳过淘汰区间，或增大输出环形缓冲区配额。 |

---

## 核心自愈操作链路

- 本地软链与注册表失效自愈：
  - 适用现象：找不到本地源码包，或修改了本地项目路径导致命令报错。
  - 自愈流程：执行 `ad info --tree` 查看挂载状态 -> 执行 `ad unlink --prune` 批量清理无效软链 -> 在包目录下重新执行 `ad link` 注册。
- 配置项缺失自愈：
  - 适用现象：执行 Action 报错提示未注入必填配置。
  - 自愈流程：执行 `ad config schema [pkg]` 查看所需配置项 -> 执行 `ad config set <key> <value>` 注入持久化配置。
