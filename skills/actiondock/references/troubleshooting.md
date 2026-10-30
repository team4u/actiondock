# 参考手册：排错与自愈决策指南

> [!NOTE]
> 本手册仅供智能体或开发者在遇到明确调用错误时定向检索。**正常流程中严禁前置执行排查命令**。

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
| `INVALID_JSON` | 要求 JSON 的输入不符合语法规范（如属性名未加双引号、空 JSON 文件或空 JSON 标准输入）。 | 校验 JSON 语法。配置与状态的完整位置值及非空 `--stdin` 使用兼容解码，不要求普通字符串为 JSON。`:=` 的严格解析错误见 `INVALID_JSON_LITERAL`。 |
| `INVALID_FLAT_ARGUMENT` | 扁平赋值语法错误、非法属性名或数组索引、原型污染敏感属性，或 `--stdin-field` 字段名为空、含点路径或危险键。 | 校验赋值与顶层字段名。属性名需符合 `[A-Za-z_][A-Za-z0-9_-]*`。数组索引为连续非负整数。杜绝 `__proto__` 等属性。`config/state set` 仅识别 `--` 后的扁平赋值，位置值 `'a=b'` 仍为字符串。 |
| `INVALID_JSON_LITERAL` | `path:=json` 中的 JSON 字面量解析失败或包含非有限数（`Infinity`、`-Infinity`、`NaN`）。 | 校验 `:=` 后的 JSON 语法是否合法。确保所有数值满足 `Number.isFinite`。 |
| `INPUT_PATH_CONFLICT` | 扁平参数路径冲突（叶节点与容器冲突、重复赋值等），或与 stdin 绑定字段冲突。 | 校验路径层级与类型。确保数组索引从 0 开始连续编号。扁平赋值不能重复写入 stdin 绑定字段或其子路径。`run`、配置、状态与独立入口共用这些校验。 |
| `FLAT_INPUT_LIMIT_EXCEEDED` | 扁平参数超出安全限制，或 `--stdin-field` 绑定后的最终入参序列化大小超出默认 10MiB 上限。合并字段及 JSON 转义放大均计入大小。 | 缩减或分批处理正文与补充字段。`MAX_MATERIALIZED_BYTES` 表示最终入参超限。改用文件不会解除输入大小限制。 |
| `INPUT_LIMIT_EXCEEDED` | JSON 输入或 stdin 源字节超过默认 10MiB 上限。 | 缩减或分批处理输入。`MAX_INPUT_BYTES` 表示源字节超限，与最终入参大小限制独立生效。 |
| `INPUT_CONFLICT` | `run` 混用扁平参数、`--input`、`--input-file`，或字段绑定与 JSON 输入混用。`config/state set` 混用完整位置值、`--stdin` 与结构化模式。 | `run` 原有三种输入仅选其一。配置或状态写入在完整位置值、`--stdin`、结构化模式中择一。`--stdin-field` 可单独使用或与扁平赋值组合，不能与完整值或 `--stdin` 组合。 |
| `INPUT_FILE_NOT_FOUND` | `--input-file` 指定的目标文件在文件系统中不存在。 | 校验文件物理路径是否准确。或改用标准输入管道 `--input-file -` 传递数据。 |
| `INPUT_FILE_READ_FAILED` | 读取输入文件或标准输入流发生底层错误（如目标为目录、权限不足，或 `--stdin-field` 正文含非法 UTF-8 字节）。 | 校验文件权限与流可用性。原始文本场景确认输入为合法 UTF-8 编码。 |
| `INPUT_NOT_JSON` | 输入参数包含非有限数（NaN 或 Infinity）、循环引用或函数等非法类型。 | 校验调用参数，确保传递合法的纯 JSON 格式数据。推荐使用 `--input-file <path>` 传递。 |
| `OUTPUT_NOT_JSON` | Action 业务返回值包含不可序列化的非 JSON 结构。 | 校验 Action 代码返回值，剔除非有限数、循环引用或裸类实例。 |
| `INVALID_ANNOTATION` | 普通 CLI 默认同步调用发现 `actiondock.cli` 正文注解非法，在调用业务前拒绝。 | 修正清单后执行 `ad validate`。`--json` 或显式 `--text-field <field>` 可绕过默认注解。 |
| `OUTPUT_FORMAT_ERROR` | 指定正文字段缺失、不是字符串，或结果不是对象，CLI 无法提取正文。 | 查验 `ad describe`、完整执行记录与输出契约。业务记录可能已成功，不要因展示失败自动重跑有副作用的动作。 |
| `ACTION_INPUT_INVALID` | 传入参数不匹配该 Action 声明的 inputSchema 契约。 | 执行 `ad describe <id>` 调阅参数定义与必填要求，修正传参字段与类型。 |
| `ACTION_OUTPUT_INVALID` | Action 返回的对象不匹配 outputSchema 模式定义。 | 校验 Action 实现代码，确保返回结构包含全部必须属性且类型一致。 |
| `CONFIG_VALUE_INVALID` | 写入配置值未能通过模式校验（类型不匹配、包含未声明字段、缺少必填属性或超出范围等）。系统严禁在错误明细中携带实际敏感输入值，写入失败保持原有配置值不变。 | 执行 `ad config schema` 确认模式约束。按整键全量替换重新写入。系统不支持掩码直接回写、部分更新或对象合并。 |

---

### 调度与依赖链路

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `ACTION_NOT_FOUND` | 所选执行目标中找不到指定动作。 | 本地调用通过 `ad list` 查验。命名远端调用在对应 Profile 执行 `ad describe <pkg>/<action> --profile <name>`。不要在错误的宿主查找。 |
| `PACKAGE_ID_CONFLICT` | 加载范围内同一完整包 ID 由不同真实目录声明。比较完整 ID 与真实目录，同短名不同完整 ID 不冲突。失效路径与损坏清单不作为有效身份参与冲突。 | 命令以退出码 1 拒绝，不自动覆盖。执行 `ad doctor` 查看 `registry.duplicates`。移除多余工作区或独立包。同工作区内部重复则修改子包清单 ID 或移出目录。 |
| `PACKAGE_NOT_FOUND` | 本地解析缺少实现，或所选远端未装载对应包。 | 先校验实际绑定。需要本地实现时用 `ad add` 安装，开发源码用 `ad link` 挂载。纯远端依赖校验调用方绑定和远端服务，不盲目安装远端源码。 |
| `NOT_FOUND` | 显式指定的命名绑定不存在，错误详情含 `action` 与 `binding`。 | 校验调用方 `.actiondock/bindings.json` 的完全限定引用与绑定名，或编程式覆盖配置。修正后重新装配宿主，禁止修改为其他目标以绕过错误。 |
| `INVALID_ARGUMENT` | 绑定配置或第三参数非法，或远端同名动作的输入输出模式与本地参照不一致。 | 第三参数仅保留 `binding`。远端目标只配置 `type` 与 `profile`，不放地址或令牌。若是契约不一致，核验两端模式，不绕过校验降级。 |
| `SERVICE_RESULT_UNKNOWN` | 远端可能已接收请求，但握手、等待或清理阶段未能确认结果。 | 保留 `profile`、`requestId`、`remoteRunId` 与 `resultUnknown`，在对应远端查原执行。无记录不代表未执行，禁止无幂等保障地重跑写操作。 |
| `ACTION_CANCELLED` | 父任务取消或执行中止。 | 停止发起新调用，不进入降级分支。`cancelOutcome: requested` 仅表示已请求，结合 `resultUnknown` 核验远端是否终止。 |
| `PACKAGE_NOT_ALLOWED` | 目标包未列入服务端启动白名单。 | 确认服务端启动参数 `-P, --package` 是否包含该包标识，或调整调用的包名。 |
| `ACTION_FORBIDDEN` | 目标动作未列入服务端允许白名单。 | 确认服务端启动参数 `-A, --action` 是否包含该动作标识（短名或全限定名），或调整调用的动作名。 |
| `UNDECLARED_ACTION_DEPENDENCY` | 跨包或跨执行目标调用未声明 `uses`，同包名跨目标也不豁免。 | 在调用方 `actiondock.json` 的对应 Action 下声明逻辑引用。不要在 `uses` 中填写 Profile 或绑定名，也不要通过换端绕过授权。 |
| `INVALID_ACTION_REF` | 跨包调用标识存在歧义，或向 invoke 传入了 Action 定义对象。 | 跨包调用使用完全限定标识符 `<pkg>/<action>`。确保 `invoke` 仅传入字符串标识符或 ActionRef 对象。 |
| `ACTION_CALL_CYCLE` | 级联调用发生循环调用或超深递归。 | 校验 Action 间的相互调用链路，消除死锁环路逻辑。 |
| `ACTION_SUBRUN_LIMIT` | 单个根任务派生的活跃子任务数超出配额限制。 | 优化业务编排逻辑，避免高并发派生大量子任务。 |
| `ACTION_TIMEOUT` | Action 执行时间超过了配置的超时阈值。本地 `ad run` 指定 `--timeout` 时，同一预算覆盖建图前事务恢复、依赖准备与动作执行。 | 优化底层耗时操作，或在调用时添加 `--timeout 60s` 增大超时时间。 |
| `ACTION_LOAD_FAILED` | Action 源码入口模块加载失败（语法错误或依赖缺失）。 | 校验入口文件物理路径与 TypeScript 语法，并在包目录下执行依赖安装。 |
| `UNMET_LOCAL_DEPENDENCY` | Action 源码引用了未在 files 字段中声明的本地代码模块。 | 在 `actiondock.json` 中配置 `"files": ["<dir>"]`（例如 `"files": ["src"]`）。 |
| `DEPENDENCIES_NOT_READY` | 必需直接生产依赖未物化且禁止自动首装，或已有 node_modules 存在损坏。 | 若使用了 `--no-install` 或环境变量禁用，说明明确禁止安装，报告依赖未就绪，禁止擅自安装绕过策略。用户要求预装或依赖损坏时，在根目录执行安装修复。 |
| `DEPENDENCY_INSTALL_FAILED` | 自动依赖安装进程启动失败、超时、退出码错误，或 Windows 环境下未检索到标准包管理器布局。 | 校验安装根目录包管理器配置、网络或锁文件冲突。Windows 下确保 PATH 包含标准 npm 安装或原生程序。非标准 wrapper 须更换为标准环境。 |

---

### 保存与数据目录冲突

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `PROJECT_BUSY` | 活跃进程仍持有工程修改锁。 | 等待当前依赖操作结束或确认取消完成，不并发修改同一工程。 |
| `PROJECT_RECOVERY_REQUIRED` | 工程存在未恢复的依赖事务，或恢复安装失败、禁装策略拒绝安装。 | 在允许安装时，通过 `ad add`、`ad remove` 或本地 `ad run` 完成恢复。未恢复前不能开启新修改事务，不移除事务快照绕过恢复。 |
| `STORAGE_WORKER_EXITED` | SQLite 保存工作线程错误退出。 | 查看保存驱动错误日志，重启 Host 进程或重新触发命令。 |
| `DATA_DIR_IN_USE` | 另一个活跃进程（记录有活跃 PID）锁定占用了数据目录。 | 停止冲突进程，或通过 `--data-dir <path>` 指定独立的保存目录。 |
| `DATA_DIR_RECOVERY_REQUIRED` | 前序主进程已退出，但其残留子进程仍在执行阻碍接管。 | 移除未退出的残留孤儿进程后再行启动。 |
| `RUN_REPOSITORY_UNAVAILABLE` | 执行记录仓储服务不可用，底层保存连接尚未初始化或已关闭。 | 确认 Host 实例是否正常启动，校验数据目录读写权限。 |
| `STORAGE_BUSY` | 数据库写入事务重试耗尽，底层 SQLite 忙等待超时。 | 降低并发写入压力或校验是否存在长事务占用。 |
| `CONFIG_ENCRYPTION_ERROR` | 加密密钥不可用、无效或与数据库记录的密钥身份指纹不一致（换用了另一把密钥）。 | 恢复原密钥来源：`ACTIONDOCK_ENCRYPTION_KEY` 或 `~/.actiondock/keys/config.key`（`--data-dir` 时为 `<dataDir>/keys/config.key`）。首版不支持密钥轮换，不要尝试换钥写入。 |
| `CONFIG_DECRYPT_FAILED` | 密文格式非法、认证失败或加密负载损坏。 | 用配套备份库与对应密钥恢复受影响数据。密钥本身缺失或指纹不匹配属于 `CONFIG_ENCRYPTION_ERROR`，先恢复密钥来源再重试。旧版本程序打开 v3 加密库也会返回拒绝，先用新版本程序或恢复保留的 v2 备份库。 |

---

### 协议与环境适配

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `TARGET_PROTOCOL_UNSUPPORTED` | 客户端与远程 Runner 服务的协议版本不匹配。 | 升级本地 CLI 或远程 ActionDock 服务版本保持一致。 |
| `TARGET_CAPABILITY_UNAVAILABLE` | 请求了目标宿主未启用的能力（如单次执行中请求异步任务）。 | 校验目标服务支持的能力清单，使用匹配的调用模式。 |
| `UNSUPPORTED_BUILD_MODE` | 传入了已废弃的编译选项（如 `--target`、`--bytecode`、`--standalone`）。 | 移除废弃参数，使用标准的 Node.js 目录构建或 `--mode node` 模式。 |
| `UNAUTHORIZED` | 访问受保护的 HTTP 或 MCP 服务时未提供有效令牌。 | CLI 直连校验目标参数。内部命名远端调用校验执行宿主上绑定所指 Profile 及其令牌环境变量。不向 `ctx.actions.invoke` 传递 token，不通过降级绕过授权。 |
| `INSECURE_TRANSPORT` | 携带认证令牌向非本地回环的明文 HTTP 服务发起请求时，安全策略阻断请求。 | 推荐在服务端以 `--https` 启用安全传输。或在客户端通过 `-k, --insecure` 或 `--allow-insecure-http` 显式豁免。 |
| `TARGET_CLOSED` | 尝试在已显式调用过 close() 关闭的远程目标门面实例上调用操作方法。 | 校验目标门面的生命周期管理，确保在所有异步调用完成前不要提前调用关闭。 |

---

### 受管进程与系统命令

| 错误代码 | 产生原因 | 标准排查与自愈步骤 |
| :--- | :--- | :--- |
| `PROCESS_SPAWN_ERROR` | 外部系统命令派生失败，可执行程序不存在或缺少执行权限。 | 校验命令路径拼写与环境变量，确认可执行文件的执行权限。 |
| `PROCESS_TIMEOUT` | 命令执行超过 `timeoutMs`，或终止后未在清理期限内完成退出与输出收敛。 | 根据错误详情区分执行超时与清理超时。前者可优化命令或调整 `timeoutMs`，后者校验仍持有输出管道的后代进程。终止失败通过原调用报告。 |
| `PROCESS_OUTPUT_LIMIT` | 外部命令输出累计字节数超出配置的缓冲区上限（`maxOutputBytes`）。 | 增加流式过滤处理，或调大 `maxOutputBytes` 缓冲上限。 |
| `PROCESS_QUARANTINED` | 长期交互进程因错误控制失效、中断或脏状态已进入隔离终止状态。 | 捕获错误并排查进程崩溃原因，重新调用 `start` 启动新进程实例。 |
| `OUTPUT_GAP` | 环形输出缓冲区发生覆盖淘汰，且读取策略配置为错误阻断。 | 将读取策略调整为 `onGap: "skip"` 跳过淘汰区间，或增大输出环形缓冲区配额。 |

---

## 核心自愈操作链路

- 同 ID 包来源冲突：
  - 适用现象：链接、查询或执行抛出 `PACKAGE_ID_CONFLICT`。此现象常见于同时挂载开发仓与安装版。
  - 恢复流程：执行 `ad doctor` 查看冲突来源。按错误指引执行 `ad unlink "多余工作区根目录"`。独立包则解除其包目录，再重新执行 `ad link`。同真实目录重复登记允许去重，不同目录需要显式选择来源。
  - 范围与内部重复：若重复 ID 来自同一工作区内部，应修改子包清单 ID 或移出多余目录。只解除后再重新链接同一工作区不能消除内部重复。解除工作区会同时解除其中其他包。只解除子包记录后，工作区仍可能动态扫描发现它。存在冲突时 `ad unlink` 仍可执行。支持当前完整 ID 或物理路径，移除同来源旧别名且不误删其他有效来源。
  - 修复后重新启动已有的 `serve`、MCP 等常驻宿主以应用新包集合。显式远端调用在目标宿主排查，不根据本机同名包自动切换目标。
- 独立包改 ID 与损坏清单恢复：
  - 适用现象：独立包修改包 ID、连续重命名、交换 ID，或清单损坏抛出错误。
  - 恢复流程：独立包清单修改 ID 后，查询即按当前清单生效。链接在注册表锁内校验并统一同步索引。连续重命名或交换 ID 不会覆盖其他有效来源。冲突状态下按独立包目录或工作区根路径仍能解除。
  - 坏清单处理：失效路径和损坏清单不作为有效身份参与冲突。失效来源执行 `ad unlink --prune` 移除。损坏来源（含新扫描出的无缓存坏清单）通过宿主告警与 `ad doctor` 的 `registry.global` 报告。在对应目录下修复清单文件即可恢复。受限诊断不能确认归属时不暴露未授权物理路径。
- 本地软链与注册表失效自愈：
  - 适用现象：找不到本地源码包，或修改了本地项目路径导致命令抛出错误。
  - 自愈流程：执行 `ad info --tree` 查看挂载状态。随后执行 `ad unlink --prune` 批量移除无效软链。最后在包目录下重新执行 `ad link` 注册。
- 命名绑定与远端状态排查：
  - 适用现象：同名动作执行位置不符、绑定不存在，或远端结果无法确认。
  - 排查流程：从错误详情及父任务事件确定调用方、引用、绑定与 Profile。校验执行宿主上的绑定快照配置。使用远端 `runId` 或本次子调用的 `requestId` 在对应 Profile 查询记录。
  - 边界：调整配置后重新装配宿主。不以切换 CLI 默认 Profile 替代内部绑定。不记录凭据，不把断链视作未执行。详见 [action-bindings.md](action-bindings.md)。
- 配置项缺失自愈：
  - 适用现象：执行 Action 报告未注入必填配置。
  - 自愈流程：执行 `ad config schema [pkg]` 查看所需配置项与模板定义。组装完整配置值再写入。敏感字段可引用已有环境变量：`printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root`。受控完整文件可用 `ad config set MYSQL_191 --stdin < connection.json`。不要把真实密码直接写入命令文本。
- 配置写入校验失败自愈 (CONFIG_VALUE_INVALID)：
  - 适用现象：执行 `ad config set` 报告 `CONFIG_VALUE_INVALID`。
  - 自愈流程：执行 `ad config schema [pkg]` 查验模式约束与受限字段。修正完整输入，按整键全量替换重新写入。扁平赋值与字段绑定不会合并旧对象。缺少密码等必填字段也会失败并保留旧值。系统不支持掩码回写或部分更新。
- 配置与状态输入失败：
  - 模式冲突、扁平赋值解析与路径错误均在读取 stdin 或实际写入前以参数错误退出。退出码为 2，系统不吞错或部分写入。不要靠追加另一种输入方式掩盖错误。完整规则见 [cli.md](cli.md#运行时配置与状态持久化-ad-config-ad-state)。
  - `--stdin` 空输入报告参数错误。`--stdin-field` 空输入则绑定为空字符串，保留 BOM、换行与全部空白，不猜测 JSON。字段绑定只改变输入渠道，不自动加密或脱敏状态。状态读取可能展示原文，不能按配置安全视图的保护程度使用。
