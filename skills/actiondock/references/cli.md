# 参考手册：CLI 命令行速查

`ad` 是 ActionDock 2.x 的统一命令行门面工具，用于驱动 Action 与 Skill 的创建、依赖管理、能力检索、本地执行、状态配置管理、测试套件调度、目录构建、打包分发与技能导出。

---

## 退出码规范

ActionDock CLI 遵循确定性的退出码规范，供宿主环境、脚本与智能体识别执行状态：

- 退出码 0：执行成功。业务操作正常完成，或正常展示帮助与版本信息。
- 退出码 1：执行失败。包括业务逻辑执行抛错、超时中止、目标服务不可达等运行时异常。
- 退出码 2：命令行参数或选项校验失败。包括缺少必填参数、参数格式非法或存在未知选项。
- 退出码 130：进程接收外部中断信号退出。包括用户中断操作或接收系统终止信号。

---

## 全局通用选项与输出信封

绝大多数子命令均支持以下通用控制选项：

- `-v, -V, --version`：打印 CLI 工具版本号并退出。
- `-h, --help`：打印命令帮助说明并退出。
- `--json`：以标准 JSON 格式输出结果。
- `--data-dir <path>`：指定运行时数据库存储目录（覆盖默认的 `.actiondock/data/` 存储路径，仅隔离包级与全局 SQLite 数据库）。
- `ACTIONDOCK_HOME=<path>`（环境变量）：重定向 ActionDock 用户根目录基准，用于彻底隔离全局环境配置（`profiles.json`）、包注册表（`registry.json`）与安全证书（`certs/`）。

---

## 全量子命令速查

### 工程脚手架与意图检索

- 项目初始化 (`ad init`)：
  ```bash
  ad init [directory] [--id <package-id>] [--name <name>] [--desc <description>]
  ```
  初始化生成包含 `actiondock.json`、`actions/`、`playbooks/` 与 `tests/` 的标准工程。

- 新建 Action 模板代码 (`ad action create`)：
  ```bash
  ad action create <id> [-d, --desc <description>] [-f, --file <filePath>] [-i, --input <fields...>] [-o, --output <fields...>]
  ```
  在当前工程中生成新 Action 模板源码并在 `actiondock.json` 中自动注册契约与生成类型。
  - 参数说明：
    - `-d, --desc <description>`：Action 功能描述。
    - `-f, --file <filePath>`：指定源码文件相对于 actions 目录的相对路径。
    - `-i, --input <fields...>`：输入模式简写字段列表，格式如 `name:string, count?:number`。
    - `-o, --output <fields...>`：输出模式简写字段列表，格式如 `message:string, success:boolean`。
  - 简写语法与边界说明：
    - 支持的基础类型包括 `string`、`number`（或 `int`、`integer`）、`boolean`（或 `bool`）、`array`（或 `list`）、`object`（或 `json`）。
    - 字段名以 `?` 结尾表示该字段为可选。
    - 命令行简写仅用于快速初始化代码骨架；深层嵌套属性、字段说明、枚举取值、正则校验、数值范围等复杂语义规范，需在 `actiondock.json` 中扩展标准 JSON Schema，并运行 `ad generate types` 刷新类型。

- 新建 Playbook 规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中生成新 Playbook 规程 Markdown 文件并在 `actiondock.json` 中自动注册。

- 能力检索与意图发现 (`ad info`)：
  ```bash
  ad info [patterns...] [-i, --intent <pattern>] [--tree] [--fallback] [--no-fallback] [-P, --package <id>] [--profile <name>] [--server <url>] [--token <token>] [--data-dir <path>] [--json]
  ```
  能力发现的首选入口。支持模糊意图过滤与通过 `--tree` 打印层级挂载依赖树。

- 环境诊断与体检 (`ad doctor`)：
  ```bash
  ad doctor [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  检查运行时环境、底层 SQLite 存储状态、配置就绪度及全局链接有效性。`registry.duplicates` 检查当前诊断范围内的包 ID 是否对应多个真实目录，发现首个冲突即报告 `status: error`，命令以退出码 1 结束；冲突不阻止生成诊断报告。`doctor` 授权范围只控制报告对象，默认不扩大对外授权；已链接依赖在白名单外不等于缺失，依赖按完整引用定向确认，无关包冲突不干扰。失效路径与损坏清单不作为有效身份参与冲突，失效来源保留清理诊断，损坏来源（含新扫描出的无缓存坏清单）通过宿主告警与 `registry.global` 报告，受限诊断不能确认归属时不暴露未授权物理路径。

---

### Action 开发、校验与执行

- 列出 Action 清单 (`ad list` / `ad action list`)：
  ```bash
  ad list [patterns...] [-i, --intent <pattern>] [--fallback] [--no-fallback] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  检索并列出当前包、工作区或远端服务中已注册的 Action 清单。

- 查看 Action 详情与模式规范 (`ad describe` / `ad action describe`)：
  ```bash
  ad describe <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  作为编码顾问调阅指定 Action 的详细信息。不仅展示描述与依赖，还包含：
  - 输入模式字段明细：字段名、类型、是否必填与字段描述。
  - Flat 编码指引：字符串赋值格式（`path=value`）、JSON 标量与结构赋值格式（`path:=json`）与数组元素赋值格式（`path.0=...`）。
  - 建议赋值样例展示：基于 `inputSchema` 声明类型提供无副作用的赋值示例数据。
  - 输出选择契约说明：清晰展示默认正文字段、stdout 与 stderr 通道语义、`--json` 完整信封读取方式、`--text-field <field>` 显式改选正文方式及仅适用于同步执行的边界。普通 CLI 未声明默认正文时解释通用输出规则，不嗅探私有字段；目录型入口如实描述现有 `content`、`text`、`message` 提取规则，不宣传其不支持的 `--text-field` 选项。

- 执行 Action (`ad run` / `ad action run`)：
  ```bash
  ad run <id> [control-options] [-- <assignments...>]
  # 或使用互斥的输入选项：
  # ad run <id> [-i, --input <json> | -f, --input-file <path|->] [control-options]
  # 原始文本管道绑定（可与扁平赋值组合）：
  # printf '正文' | ad run <id> --stdin-field <field> [-- <assignments...>]
  ```
  本地或远程执行指定 Action，支持 `--async` 异步启动。
  - 协议边界：`--` 分隔符作为控制平面（ActionDock 选项如 `--text-field`、`--json`、`--config`、`--data-dir`、`--profile`、`--timeout` 等）与数据平面（Action 入参）的协议边界。
  - 两种赋值操作符：
    - `path=value`：严格保留为字符串，不执行 JSON 解析与类型猜测。
    - `path:=json`：严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
  - 路径语法规则：
    - 命名段（`^[A-Za-z_][A-Za-z0-9_-]*$`）表示对象属性。
    - 纯数字段（`^(0|[1-9][0-9]*)$`）表示数组索引，数组索引必须从 0 开始连续编号，拒绝稀疏数组。
    - 根节点始终物化为对象。
    - 路径冲突（叶节点与容器冲突、对象与数组冲突、重复赋值）严格拒绝（`INPUT_PATH_CONFLICT`）。
    - 拦截原型污染敏感属性（`__proto__`、`constructor`、`prototype`）。
  - 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）；未指定任何输入参数时，默认传入空对象 `{}`。
  - 原始文本输入：`--stdin-field <field>` 将 stdin 完整正文（至 EOF）原样绑定为指定顶层入参字段的字符串值，适合管道传入 Markdown、CSV、补丁等原始文本。下例假定 `summarize` 与 `render` 是已注册且具有相应字符串入参的示例动作：
    ```bash
    printf '这是一段正文' | ad run summarize --stdin-field text -- style=brief
    cat report.md | ad run render --stdin-field content
    ```
    - 正文严格保持字符串，不猜测 JSON、数字或布尔；不剥离 BOM、不修剪首尾空白，保留 CRLF、引号、反斜杠与 Unicode；空 stdin 绑定为空字符串，是否允许由 `inputSchema` 裁决。
    - 可与 `--` 后扁平赋值组合；与 `--input`、`--input-file`（含 `-`）互斥；flat 重复占用同名或子路径报 `INPUT_PATH_CONFLICT`；非法字段名报 `INVALID_FLAT_ARGUMENT`，均在读取与执行前。
    - stdin 源字节与最终入参序列化结果各自受默认 10MiB 上限约束；分别超限报 `INPUT_LIMIT_EXCEEDED` 与 `FLAT_INPUT_LIMIT_EXCEEDED`，合并字段及 JSON 转义放大也计入最终大小。非法 UTF-8 报读取失败而非 JSON 解析失败；等待 stdin 时 Ctrl-C 可退出。
    - 管道非事务：`pipefail` 只能反映失败不能阻止下游已写入；高风险写入建议先完整生成并校验再执行。
  - 依赖按需准备与 `--no-install`：
    - 仅本地 `ad run` 默认按需准备依赖：主动作与宿主包图快照中已有的本地子动作均在授权后、实际首次执行调用前按需准备依赖；
    - 若当前工程在 `actiondock.json.dependencies` 中声明了正式 Action 包依赖，CLI 会先按工程依赖完成建图所需的首次准备，再固定宿主快照；这一步同样遵守禁装策略。仅普通 npm 依赖缺失时，未知动作不会触发安装；
    - 未注入准备回调时，SDK、`ad serve`、`ad mcp` 不新增按需首装行为；既有事务崩溃恢复安装仍受 `allowInstall` 及 `ACTIONDOCK_AUTO_INSTALL` 环境变量控制；
    - 命令行指定 `--no-install` 或环境变量 `ACTIONDOCK_AUTO_INSTALL=false` 时，整条调用链均禁止自动首装与恢复安装，仍会检查依赖是否就绪，智能体严禁绕过；
    - `uses` 仅为调用权限授权，不能作为安装清单；未被实际调用的已登记包不会单独触发准备。一次安装的范围仍由安装根的 `package.json` 与工作区配置决定；
    - 远端子动作通过对应 Profile 在远端执行，绝不在本机执行依赖查找或安装（即使本机存在同名包）；
    - 运行期不会动态扩大宿主包图快照，新 Action 包不会在运行期自动加入宿主；
    - 子动作依赖准备失败不会撤销父动作此前已产生的副作用，框架也绝不自动重跑父动作；
    - 依赖判定以必需直接生产依赖元数据是否物化为依据，不执行业务代码，不承诺完整依赖健康检查，`optionalDependencies` 缺失不视为必须安装；
    - 若安装根已存在 `node_modules` 但必需生产依赖缺失或损坏，严禁自动重建，将抛出 `DEPENDENCIES_NOT_READY` 并提示手动修复；目标原始路径或真实路径位于 `node_modules` 时均跳过首装，不沿符号链接进入外部源码目录安装；
    - 依赖安装进度输出至 stderr，机器输出 stdout 保持协议完整；安装失败、超时或被取消时不启动对应 Action 且不自动重试；
    - 本地调用指定 `--timeout` 时，同一预算覆盖建图前事务恢复、冷首装、目标包准备与动作执行；前置或准备阶段耗尽预算报 `ACTION_TIMEOUT` 且不启动动作，SIGINT 中断仍归并为退出码 130；幂等摘要使用用户声明的原始时限，不受准备耗时影响，更改原始时限仍会触发幂等冲突；
    - 当前工程存在待恢复事务时，CLI 在读取清单与建图前先完成事务恢复（快照回滚与冻结安装）；禁装策略下在任何文件修改前直接报 `PROJECT_RECOVERY_REQUIRED`。
  - 机器输出模式：仅在需要结构化提取时使用 `--json`，输出标准 JSON 结果信封并忽略默认正文注解；当参数解析出错时输出标准错误信封并以退出码 2 退出；业务执行成功输出成功信封，业务执行失败以退出码 1 退出。
  - 纯文本输出模式：
    - 默认模式：未指定 `--text-field` 且无声明式注解时，标量直接输出，结构化对象以标准 JSON 格式输出到 stdout，不进行私有业务字段自动嗅探。
    - 显式正文输出：传入 `--text-field <field>` 时，仅提取结果中指定顶层自有字符串字段输出至 stdout（保留真实换行且无 JSON 转义），其余字段以格式化 JSON 对象输出至 stderr（元数据为空时不输出）。
    - 声明式默认正文：Action 清单中声明 `annotations["actiondock.cli"] = { "textField": "<field>" }` 时，未指定 `--text-field` 的同步执行自动应用该正文与元数据输出行为；显式 `--text-field` 优先于默认注解。
    - 严格校验：正文字段缺失、非字符串或返回数据非对象时，明确输出错误并以退出码 1 退出；`--text-field` 与 `--json`、`--async` 严格互斥并在执行前以退出码 2 退出。
  - 单次调用配置覆盖：`-c, --config <assignment>` 支持临时配置覆盖：
    - `-c KEY=value`：保留为纯字符串，不进行 JSON 猜测。
    - `-c KEY:=json`：按严格 JSON 解析且递归要求数值为有限数（`Number.isFinite`）；不物化路径，语法或解析出错时立即以退出码 2 退出。独立运行分发入口同语义。
  - 传统输入选项：
    - 简单输入：使用 `-i, --input <json>` 传递内联 JSON 字符串。
    - 文件输入：使用 `-f, --input-file <path>` 从 JSON 文件读取内容并解析。
    - 标准输入：使用 `-f, --input-file -` 从标准输入读取全部内容并解析。
    - 转义安全：复杂对象或多行长文本推荐使用 `--input-file` 传递，避开终端引号转义问题。JSON 文件及 stdin JSON 在解析前剔除 UTF-8 BOM，默认大小上限为 10MiB；改用文件不会解除限制。`--stdin-field` 保留正文 BOM。

- 校验 Action 模式与契约 (`ad validate` / `ad action validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  校验清单规范有效性、入参出参模式、输出契约合规性与引用的入口文件物理存在性。
  - 输出契约校验：静态分析 `annotations["actiondock.cli"].textField` 与 `outputSchema` 的兼容性，新增分析自身只读取元数据；整个校验命令的其他检查仍会加载动作定义，但不调用业务 `run`。
  - 确定矛盾拦截：非法注解、无效正文字段声明、Schema 明确拒绝对象或字符串字段、目标字段未声明且没有 `patternProperties` 约束并禁止额外属性时，报告错误并以退出码 1 退出。
  - 风险透明诊断：根类型或字段类型无法确定、字段允许非字符串或未标记为 `required`、Schema 缺失、复杂组合或 `patternProperties` 约束时，给出警告而不误拒合法结果；`--json` 下各动作的诊断结果可包含 `warnings` 数组。

- 自动生成 TypeScript 类型声明 (`ad generate types`)：
  ```bash
  ad generate types [--json]
  ```
  基于 `actiondock.json` 中声明的 Schema 自动生成强类型声明文件（`.actiondock/generated/actions.d.ts`）。

- 执行单元测试 (`ad test`)：
  ```bash
  ad test [pattern]
  ```
  调用配置的测试运行器执行测试套件。

---

### 运行历史与长任务管理 (`ad runs`)

- 列出历史执行记录 (`ad runs list`)：
  ```bash
  ad runs list [patterns...] [-a, --action <actionId>] [--channel <channel>] [--status <status>] [--offset <count>] [--with-total] [--since <time>] [--until <time>] [--root-run-id <id>] [--parent-run-id <id>] [--view <viewName>] [--request-id <id>] [-n, --limit <count>] [-P, --package <id>]
  ```
  支持通道、状态、时间区间与分页过滤：`--channel <channel>`（如 `http`、`mcp`）、`--status <status>`、`--offset <count>`、`--since`、`--until`；配合 `--with-total` 在 `--json` 下输出包含 `total`、`items`、`limit`、`offset` 的分页结构体。
  支持按幂等请求标识反查：`--request-id` 可重复传入多个，命中记录携带 `requestId` 字段。

- 查看执行记录详情 (`ad runs show`)：
  ```bash
  ad runs show <id>
  ```
  查看入参快照、返回值、报错堆栈、耗时与事件流。

- 阻塞等待运行终态 (`ad runs watch`)：
  ```bash
  ad runs watch [ids...] [--request-id <id>] [-P, --package <id>] [--timeout <duration>] [--interval <duration>] [--resolve-timeout <duration>] [-q, --quiet] [--json]
  ```
  阻塞等待一个或多个运行到达终态后聚合退出：本地 shell 并发起多个 `ad run` 后台进程后，用一条 watch 命令阻塞到全部终态再收结果；`--request-id` 适用于后台派工后主控无 runId 的场景（反查带有限重试）；`--timeout` 为整体上限，超时或中断仅退出等待，不取消任务；机器模式输出聚合对象，`ok` 仅在全部终态且全部执行成功时为真。

- 取消正在运行的异步长任务 (`ad runs cancel`)：
  ```bash
  ad runs cancel <id> [-r, --reason <reason>]
  ```

- 清理历史运行记录 (`ad runs clear`)：
  ```bash
  ad runs clear [-P, --package <id>] [-a, --action <actionId>] [--status <status>] [--older-than <duration>] [--keep <count>]
  ```

---

### 规程管理 (`ad playbook`)

- 列出规程清单 (`ad playbook list`)：
  ```bash
  ad playbook list [patterns...] [-i, --intent <pattern>] [-P, --package <id>]
  ```

- 查看规程完整内容 (`ad playbook show`)：
  ```bash
  ad playbook show <id> [-P, --package <id>]
  ```

- 校验规程合法性 (`ad playbook validate`)：
  ```bash
  ad playbook validate [id] [-P, --package <id>]
  ```
  检查规程引用的所有 Action 是否在本地工程或依赖包中真实存在。

- 创建新规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```

---

### 依赖安装与包管理 (`ad add`, `ad remove`, `ad pack`)

- 安装并锁定依赖 (`ad add`)：
  ```bash
  ad add <package> [--allow-install-scripts] [-D, --dev] [-P, --package <path>] [--json]
  ```
  安装并锁定 Action 包依赖，受原子事务保护，自动更新单一事实源锁文件 `actiondock.lock.json`。
  中断取消（如 Ctrl-C）会终止安装进程并等待其退出、释放工程排他锁，事务保留 `pending` 状态交由下一次允许安装的持有者命令恢复，不会把部分变更伪装成回滚一致，也不会自动重试安装。后续 `ad add` 或 `ad remove` 在读取清单、检查依赖与创建新快照前先完成恢复；恢复失败或被取消时不继续修改，核心事务入口也拒绝在未恢复事务上叠加新事务。

- 移除依赖并更新锁定 (`ad remove`)：
  ```bash
  ad remove <package> [-P, --package <path>] [--json]
  ```
  检测反向引用，安全移除 Action 包依赖，保留数据命名空间。中断取消行为与 `ad add` 一致：终止卸载进程、释放工程锁并保留 `pending` 事务待恢复。

- 打包 npm 分发包 (`ad pack`)：
  ```bash
  ad pack [-P, --package <id>] [-o, --out <path>] [--dry-run] [--json]
  ```
  将 Action 包打包为标准 npm 压缩包（`.tgz`），支持 `--dry-run` 预览打包摘要。

---

### 交付构建与技能导出 (`ad build`, `ad export skill`)

- 构建 Node.js 运行时交付目录 (`ad build`)：
  ```bash
  ad build [-P, --package <id>] [-o, --out <path>] [-a, --actions <actions...>] [-p, --playbooks <playbooks...>] [-z, --archive] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  将 Action 构建为 Node.js 交付目录或归档包。支持通过 `--vendor-deps` 固化生产依赖。

- 导出智能体技能资产 (`ad export skill`)：
  ```bash
  ad export skill [-P, --package <id...>] [--workspace] [--all] [--bundle [name]] [-m, --mode <mode>] [-o, --out <path>] [-p, --playbook <playbooks...>] [-a, --actions <actions...>] [-z, --archive] [--skill-md <path>] [--custom-md <path>] [--skill-md-only] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  导出 Agent Skill 技能目录，支持源码型（默认）与 Node.js 目录型（`--mode node`）。
  复合套件导出（`--bundle`）支持通过 `--custom-md <path>` 注入自定义说明书，并通过 `--skill-md-only` 原位刷新说明书。

---

### 运行时配置与状态持久化 (`ad config`, `ad state`)

`config set` 与 `state set` 共用以下输入规则，独立运行入口也相同：

- 完整位置值：`[value]` 必须在 `--` 前，合法 JSON 自动解码，支持根数组与标量，否则保留为字符串。`ad state set note 'a=b'` 仍写入字符串，不猜为扁平赋值。
- 扁平对象：仅识别 `--` 后的赋值，`path=value` 保留字符串，`path:=json` 严格解析 JSON；点路径、从 0 开始的连续数组、重复或结构冲突及危险键检查均继承 `ad run`，根节点为对象。
- 完整标准输入：`--stdin` 读取全部内容，裁剪末尾 CR/LF，再按 JSON 或普通字符串解码；空输入报参数错误。配置原有语义不变，状态新增相同能力。
- 原始字段绑定：`--stdin-field <field>` 将 stdin 原始文本绑定为指定顶层字段的字符串值，保留 BOM、换行与全部空白，不猜测 JSON，空输入为空字符串。字段名不得为空、含点路径或危险键；可单独使用或与扁平赋值组合。
- 互斥与错误：完整位置值、`--stdin`、结构化模式（扁平赋值及字段绑定）互斥；`--stdin-field` 不与完整值或 `--stdin` 组合。模式冲突、赋值解析与路径错误在读取 stdin 或写入前以退出码 2 拒绝，不吞错或部分写入。
- 大小与取消：管道读取沿用默认 10MiB 源字节上限与取消语义；字段绑定后最终对象序列化也受默认 10MiB 上限约束，补充字段与 JSON 转义放大均计入大小。字段绑定只改变输入渠道，不自动加密或脱敏状态。

- 运行时配置管理 (`ad config`)：
  ```bash
  # 列出配置项（安全脱敏视图）
  ad config list [patterns...] [-g, --global] [-P, --package <id>] [-i, --intent <pattern>]
  # 读取配置安全视图
  ad config get <key> [-g, --global] [-P, --package <id>]
  # 写入配置键值（全量替换，写前校验）
  ad config set <key> [value] [-g, --global] [-P, --package <id>] [--stdin | --stdin-field <field>] [--browser] [-- <assignments...>]
  # 浏览器交互式录入敏感配置
  ad config set <key> [-g, --global] [-P, --package <id>] --browser
  # 删除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>]
  # 查看包配置模式（通配模板单列 TEMPLATE 并统计 matchCount）
  ad config schema [identifier] [-P, --package <id>]
  # 输出环境导出语句
  ad config env [identifier]
  ```
  - 安全脱敏视图：`ad config list` 与 `ad config get` 始终返回脱敏安全数据。敏感整项展示 `<hidden>`，未配置项展示 `<not configured>`。系统不提供任何明文查看参数，原 `--reveal` 与 `--show-secrets` 已移除；需要原值请在 Action 内通过 `ctx.config.get` 读取。
  - 标准输入注入：敏感字段从已有环境变量读取，完整对象可从受控文件读取，避免把真实密码直接写入命令文本：
    ```bash
    printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
    ad config set MYSQL_191 --stdin < connection.json
    ```
  - 浏览器敏感配置录入：`ad config set <key> [-g, --global] [-P, --package <id>] --browser` 通过本地临时页面录入凭据，不经命令参数或模型对话传递；输入渠道与保存作用域正交，保存后退出，不自动执行 Action。
    - 适用范围与目标：支持本地包级目标与全局配置（`-g/--global`），拒绝显式远端参数（`--server` 与 `--profile`）以及默认激活 Profile 决议出的隐式远端目标；包级寻址失败时明确报错，绝不退回全局作用域。包级需匹配目标包声明，全局需匹配当前宿主所有已加载包声明，要求至少有一项顶层 `secret: true` 且所有显式类型均为 `string`。全局配置在多个包同名声明时共享写入，同名包级配置优先生效。
    - 参数互斥约束：`--browser` 与位置参数值、`--stdin`、`--stdin-field` 以及 `--` 分隔符后的结构化赋值严格互斥（包含显式空分隔符 `--`），冲突时在读取流、启动服务与写库前以退出码 2 退出。
    - 声明模式校验：仅支持已声明且顶层为 `secret: true` 的字符串配置；拒绝未声明项、仅嵌套属性敏感项及非字符串声明；无显式类型的顶层敏感配置可按字符串输入。页面支持多行，显示与隐藏切换不改变输入内容；保留首尾空白，不将 `123`、`false` 或 JSON 外观文本自动解码。浏览器将 CR 与 CRLF 换行统一为 LF；需要保留原始换行编码时，使用包含转义换行的 JSON 字符串，例如通过 `ad config set <key> --stdin < secret.json` 写入受控文件中的完整 JSON 字符串。
    - 交互与安全边界：仅监听 `127.0.0.1` 随机端口，严格校验精确 Host、Origin（POST 缺失 Origin 直接拒绝）与一次性凭据，完整 JSON 请求体的 UTF-8 大小最大为 64KiB；超限时明确提示，可缩短内容重试或取消。页面无第三方资源、不回显旧值，使用内容安全策略并禁止缓存。输入等待自创建起最多 5 分钟，校验失败或请求体超限不重置期限；等待时可页面取消或终端中断，一旦进入保存阶段则等待实际写入结果，不再取消或超时打断。
    - 存储与降级说明：声明判定敏感的配置一律整键静态加密落盘（见下方敏感配置静态加密），仅非敏感配置保持明文；本录入渠道自身仍只接受顶层敏感字符串，这是输入资格限制，不影响其他输入渠道写入的嵌套敏感对象同样整键加密。静态加密不构成对已授权 Action 或本机程序的秘密隔离。URL 片段携带临时提交权限，请勿分享链接；无法确认自动打开浏览器成功时，标准错误流提示手动打开链接并继续等待。
  - 敏感配置静态加密：
    - 加密语义：当前声明判定敏感的配置键（顶层 `secret: true` 或内嵌模式字段级敏感）写入包级或全局持久化库时自动整键加密（AES-256-GCM，密文 `adenc:v1:<密钥指纹>:<密文>`）；已加密行后续写入保持加密且保护只能增强，不回退降级为明文。非敏感配置仍为明文 JSON，状态与运行记录不加密。
    - 自动迁移：早期版本以明文保存的敏感配置无需迁移命令；升级程序后首次打开旧版（v2）库时，存储启动迁移在同一个写事务内按当前声明加密存量敏感明文（具体键优先于通配模板，全局库取已加载包声明并集）、记录密钥身份并升级为当前结构（v3），失败整体回滚并明确报错。已是 v3 的库直接使用；后来才被新声明判定敏感的存量明文在该键下一次敏感写入时转为密文。
    - 安全边界：静态加密保证敏感写入及自动迁移识别出的敏感行以密文保存，不承诺擦除数据库旧页、历史 WAL、既有备份、文件系统快照或底层物理介质中的历史明文副本，也不自动创建备份；需要回退保障时请在升级前自行备份并妥善保管。数据库版本检查发生在打开连接时，已打开的旧版连接不会因版本变化自动退出；同一数据库的宿主进程应统一升级，迁移前停止旧版宿主，不支持新旧版本并行读写同一库。
    - 密钥与版本：密钥优先取环境变量 `ACTIONDOCK_ENCRYPTION_KEY`（64 位十六进制），否则为密钥文件 `<dataDir>/keys/config.key` 或 `~/.actiondock/keys/config.key`（`ACTIONDOCK_HOME` 可重定向）；首次需要加密时自动生成，没有敏感配置时不加载也不创建密钥；丢失后密文不可恢复，换用另一把有效密钥被拒绝（`CONFIG_ENCRYPTION_ERROR`），密文非法或认证失败报 `CONFIG_DECRYPT_FAILED`。旧版本程序只接受 v2，拒绝打开 v3 库；回退须用自行保留的 v2 备份库恢复（无需密钥）。
  - 写入原子性与写前校验：先组装完整值，再按模式校验并整键替换；缺少密码等必填字段时也报 `CONFIG_VALUE_INVALID`（错误明细严禁携带实际输入值），原值保持不变。扁平赋值不是局部更新，不支持掩码回写、部分更新与对象合并。
  - 拒绝通配符实键：`get`、`set` 与 `delete` 严格拒绝包含 `*` 的实键操作。
  - 模板诊断支持：通配模板键（如 `MYSQL_*`）单列在模式视图中并不判缺失，环境变量满足度体检自动跳过模板。列表不枚举仅在环境变量中存在的模板实例，但可按具体键执行 `get`。
  - 视图元数据：`--json` 包含 `configured`、`secret`、`source`、`value` 与 `redactedPaths`。`source` 与核心 `ConfigSource` 契约一致，仅取 `override`、`package`、`global`、`env`、`default` 或 `null`：临时覆盖（`ad run -c`）为 `override`，包级持久化为 `package`，全局持久化为 `global`，环境变量为 `env`，真实生效的声明默认值为 `default`，整链未命中为 `null`。`configured` 仅对显式来源为 `true`，`default` 与 `null` 均为 `false`；敏感默认值存在时仍会隐藏。路径使用标准 JSON Pointer，根为 `""`，属性转义采用 `~0` 与 `~1`。
  - 全局与远端保护：全局视图取各包有效声明的保护并集，包范围继承全局值也不能绕过保护且保留真实 `global` 来源。远端查询要求服务端提供 `configViewVersion: 1` 完整视图，`source` 与 `configured` 状态自洽；单键查询要求服务端返回同键完整单项视图，无匹配项由服务端返回同键 `source: null` 视图，列表响应不能伪装单项未命中。旧服务端响应被直接拒绝（`PROTOCOL_UNSUPPORTED`），不猜测来源、不降级、不返回空安全列表。本地声明只能加强远端保护，不能撤销服务端标记；整项隐藏可省略 `value` 但必须携带根隐藏路径，可选敏感字段缺失时 `redactedPaths` 为空列表且 `value` 正常展示，缺明文不等于未配置。
  - 回写与回退：不要把脱敏输出直接回写，`********` 不是保留旧值的指令。服务端回退至不支持该协议的版本后，新客户端配置查询将被拒绝，必须保留协议能力或配套调整客户端版本；回退旧版本前，必须给已存模板实例补充具体键的顶层 `secret: true` 声明。

- 持久化状态管理 (`ad state`)：
  ```bash
  # 列出状态项
  ad state list [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 列出状态键名
  ad state keys [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 写入状态键值（支持秒级过期 TTL）
  ad state set <key> [value] [--ttl <seconds>] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--stdin | --stdin-field <field>] [-- <assignments...>]
  # 删除状态项
  ad state delete <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 清空状态数据
  ad state clear [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--all]
  ```
  - 状态仍为整键替换，不合并旧对象；`-a` Action 作用域、`-n` 命名空间、`ns:key` 复合键与 `--ttl` 秒级存活时间规则不变。
  - 原始正文可与补充字段组合写入：
    ```bash
    ad state set article -n drafts --stdin-field content -- title=草稿 tags.0=笔记 < article.md
    ```
  - 状态读取可能显示原文，不具有配置安全视图的自动脱敏保障；stdin 不是凭据安全存储机制。

---

### 远程微服务与协议适配 (`ad serve`, `ad mcp`, `ad profile`)

- 启动 HTTP/HTTPS 微服务 (`ad serve`)：
  ```bash
  ad serve [-p, --port <port>] [-H, --host <host>] [-t, --token <token>] [-P, --package <package-id>] [-A, --action <action-ref>] [--views-file <path>] [--https] [--tls-cert <path>] [--tls-key <path>] [--tls-ca <path>] [--tls-passphrase <passphrase>] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>] [--data-dir <path>]
  ```
  将本地 ActionDock 项目作为微服务暴露，支持 REST 与 SSE 接口。支持通过 `-P, --package` 指定包授权白名单，通过 `-A, --action` 指定动作授权白名单，两份白名单取并集授权，越权访问返回 403 `ACTION_FORBIDDEN`。原生支持 HTTPS 协议：仅传入 `--https` 时自动在本地签发并复用自签名 X.509 证书；传入 `--tls-cert` 与 `--tls-key` 时加载生产机构证书。
  - 参数说明：
    - `-P, --package <package-id>`：包授权白名单，授予所列整包当前与未来全部动作，可多次指定或使用逗号分隔。`-P '*'` 是显式全量访问标记（不支持其他通配模式），仍不自动开启管理端点。
    - `-A, --action <action-ref>`：动作授权白名单，仅接受 `packageId/actionId` 全限定精确引用，拒绝短名与通配符，可多次指定或使用逗号分隔。只想暴露 pkg-a/read 时只写 `-A pkg-a/read`，不要再授权整包。未声明 `-P/-A` 时默认视图没有任何授权，服务无动作可用。
    - `--views-file <path>`：指定包含虚拟投影视图配置的外部 JSON 配置文件路径。支持在单个服务监听端口上划分出多个具备独立权限策略的虚拟视图，合并优先级高于 `actiondock.json` 中的 `server.views`。
  - 单端口多权限与虚拟投影视图：
    - 声明方式：支持在 `actiondock.json` 的 `server.views` 声明多视图配置，或通过 `--views-file <path>` 传入外部配置文件。命令行指定的文件优先级高于清单配置；同名视图按字段覆盖合并，显式提供的字段整项替换基础侧取值，仅覆盖 `token` 等其他字段时不会删除基础视图已有的授权字段，安全字段不会被静默丢弃。
    - 权限完全隔离：在单个监听端口下划分出多个具备独立安全策略的虚拟端点视图，免去为不同权限角色启动多个服务的运维成本。各视图拥有独立的鉴权 Token 与授权策略，越权调用拦截并返回 403。
    - 并集授权语义：每个视图以 `packageAllowlist` 与 `actionAllowlist` 声明授权范围，两份白名单取并集：
      ```json
      {
        "views": {
          "default": {
            "packageAllowlist": [],
            "actionAllowlist": [],
            "enableMcp": false
          },
          "agent": {
            "token": "agent-secret",
            "packageAllowlist": ["github-tools"],
            "actionAllowlist": ["ci-tools/trigger-build"]
          }
        }
      }
      ```
      `packageAllowlist` 中的包获得整包能力授权，覆盖该包当前与未来新增的全部动作；新增包内动作时无需变更视图配置，评估暴露面时需将其视为该视图的永久授权面。`actionAllowlist` 仅接受 `packageId/actionId` 全限定精确引用，拒绝短名与通配符；只想授权某个包的单动作时只写 `actionAllowlist`，不再授权整包。两份白名单取并集：上例中 github-tools 整包可用（含未来新增动作），同时 ci-tools 仅 `trigger-build` 单动作可见可用。某一白名单省略或为空数组只表示不增加该项授权，不会取消另一白名单的有效授权；两份白名单均无授权时，包与动作清单为空，执行请求被拒绝。`packageAllowlist: ["*"]` 为显式全量访问标记（不支持其他通配模式），适用于全开放的管理视图，仍不自动开启 `enableManagement`。
    - 视图独立性：命名视图不继承默认视图的白名单与 Token，命令行 `-P/-A` 不是所有视图的共同权限上限。通过 `/views/agent/...` 或对应 Token 请求该视图，授权声明不会改变执行宿主已装载能力的实际边界。默认视图没有任何授权时不暴露包与动作；管理员全授权视图显式使用 `["*"]`。声明命名视图不会关闭根路径，部署时应为默认视图显式声明 `packageAllowlist: []`、`actionAllowlist: []` 并关闭其 MCP，或为默认管理视图配置独立 Token 与授权。
    - 调用边界：视图授权限制对外入口，不是 Action 代码沙箱。已授权 Action 内部的 `ctx.actions.invoke` 仍按 `uses` 与运行时依赖规则执行；授权前应评估其实现与依赖，不能将“客户端不能直接调用某动作”理解为“已授权动作内部不能调用它”。
    - 历史清理边界：受限授权下，`runs/clear` 必须显式指定已获整包授权的包，或精确到已授权动作；无范围的清理、对单动作授权包的整包清理与全局 `runs/clean-expired` 均返回 403。`packageAllowlist: ["*"]` 保留全局清理能力。
    - 最小发现投影：仅持有单动作授权的包（如上例 `ci-tools`）在信息与发现接口中仅返回最小身份元数据（`id`、`name`、`version`、`description` 与已授权动作列表），不暴露完整动作清单、规程、配置定义或目录路径；整包授权的包返回安全脱敏后的完整结构。动作清单以真实注册能力为准；缺少包内清单时补查目录，查询失败透明报错，不用授权声明伪造发现结果。单动作授权不推导整包能力：目标包的其余动作、规程与 `doctor` 诊断均拒绝，MCP 工具列表与资源提示同样不包含未授权内容。
    - 管理端点门禁：通过 `enableManagement` 精细化控制配置与状态端点（`/api/v2/config` 与 `/api/v2/state`），默认关闭，仅对显式授权的视图开放。`packageAllowlist: ["*"]` 不自动开启管理能力；受限授权下 `package=global` 特殊值不能绕过包级授权。
    - 专属协议端点：各视图提供独立的 MCP 端点 `/views/:viewName/mcp` 与 RESTful 端点 `/views/:viewName/api/v2/*`，根据授权策略严格暴露纯净工具集，杜绝元数据泄露。

- 启动 Model Context Protocol 协议服务 (`ad mcp`)：
  ```bash
  # STDIO 模式启动
  ad mcp [-d, --dir <path>] [--package <package-id>] [--all] [--timeout <duration>]
  # HTTP 与 SSE 模式启动
  ad mcp serve [-p, --port <port>] [-H, --host <host>] [-t, --token <token>]
  ```
  - 命令入口即授权边界：`ad mcp` 的选定运行环境由命令入口显式授权，无需另设一套普通用户模式。STDIO 与 HTTP 模式通过 `--package` 显式声明包授权白名单，`--all` 显式授权选定运行环境中的全部包；未指定 `--package` 时，命令入口也会显式授权本次选定环境。直接调用 MCP 库且未声明白名单时，工具清单为空。入口授权不改变执行宿主已装载能力的实际边界，也不是 Action 代码沙箱。

- 管理远端执行环境配置 (`ad profile`)：
  ```bash
  ad profile list
  # 添加环境（内网自签名证书服务支持传入 -k, --insecure 跳过合法性校验）
  ad profile add <name> --server <url> [--token <token>] [--token-env <env>] [-k, --insecure]
  # 更新已有环境属性或切换安全策略
  ad profile update <name> [--server <url>] [--token <token>] [-k, --insecure] [--no-insecure]
  ad profile use <name>
  ad profile show [name]
  ad profile rm <name>
  ad profile test [name]
  ```

- 远程连接目标通用选项：
  所有支持远端调用的命令（`run`、`runs`、`state`、`config`、`doctor`、`info`、`list`、`describe`、`playbook`）均已统一支持目标连接参数：
  `-p, --profile <name>`、`-s, --server <url>`、`-t, --token <token>`、`-k, --insecure`、`--allow-insecure-http`。

- 命令目标与内部依赖绑定的区别：
  - `--profile` 与 `ad profile use` 选择主 Action 所在的执行宿主，不会把所有 `ctx.actions` 子调用强制改到同一目标。
  - 子调用通过 `ctx.actions.invoke(ref, input, { binding: "primary" })` 选择调用方 `.actiondock/bindings.json` 中的命名绑定；该文件及其引用的 Profile 在执行主 Action 的宿主上解析。
  - 当前没有 `ad run --binding`、`ad link --profile` 或通过 `ad config set` 管理绑定的命令，不要把 SDK 的 `binding` 当成 CLI 参数或业务入参。
  - 已取得远端运行标识时使用 `ad runs show <remoteRunId> --profile <name>`；只有子调用请求标识时使用 `ad runs list --request-id <requestId> --profile <name>` 反查。
  - 完整规则与显式降级示例见 [action-bindings.md](action-bindings.md)。

---

### 本地路由挂载与调试 (`ad link`, `ad unlink`)

- 注册本地包至本机路由表 (`ad link`)：
  ```bash
  ad link [path] [-r, --recursive]
  ```
  面向本地未发布源码开发联调，仅更新本地注册表（`~/.actiondock/registry.json`），不修改项目依赖。工作区是包含多个 ActionDock 子包的父目录，登记后会动态扫描子包。

  身份冲突比较有效完整包 ID 与真实目录，完整 ID 精确匹配优先于短名称；同短名称但不同完整 ID 不构成 `PACKAGE_ID_CONFLICT`，按短名称匹配到当前包时仍检查该包完整 ID 冲突。失效路径和损坏清单不作为有效身份参与冲突。独立包清单修改 ID 后查询按当前清单生效；链接在注册表锁内检查已有包、工作区动态子包及本次工作区内部重复，通过后统一同步索引；连续改名或交换 ID 不会覆盖其他有效来源，冲突时不覆盖原记录，也不残留本次的部分登记。后续查询和执行仍会检查动态冲突，当前工程不能静默覆盖另一份同 ID 链接包。

- 解除本地包注册 (`ad unlink`)：
  ```bash
  ad unlink [id|path]
  ad unlink --prune
  ```
  `ad unlink` 支持当前完整 ID 或物理路径，清除同来源旧别名且不误删其他有效来源；`--prune` 可一键清理物理路径不存在的悬空失效软链。包 ID 冲突时先用 `ad doctor` 查看来源，再执行 `ad unlink "多余工作区根目录"` 或解除多余的独立包目录，之后重新链接所需来源。若重复 ID 来自同一工作区内部，应修正子包清单 ID 或移出多余目录，只解除后再重新链接同一工作区不能消除内部重复。解除工作区会同时解除其中其他包；只解除子包记录不能阻止工作区重新发现它。`ad unlink` 不要求包集合先成功加载，存在冲突时按独立包目录或工作区根路径仍可解除。修复后重新启动已有的 `serve`、MCP 等常驻宿主。
