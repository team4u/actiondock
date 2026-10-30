# 参考手册：CLI 命令行速查

`ad` 是 ActionDock 2.x 的统一命令行工具。它驱动动作与技能的生成、依赖管理、能力检索与本地执行。它也负责状态配置管理、测试调度、目录构建、打包分发与资产导出。

---

## 统一退出码规范

ActionDock CLI 遵循确定性的退出码规范。宿主环境、脚本与智能体以此识别执行状态：

- 退出码 0：执行成功。业务操作正常完成，或正常展示帮助与版本信息。
- 退出码 1：执行失败。包括业务逻辑执行抛错、超时中止、目标服务不可达等错误。
- 退出码 2：命令行参数或选项校验失败。包括缺少必填参数、参数格式非法、输入模式冲突或存在未知选项。
- 退出码 130：进程接收外部中断信号退出。包括用户输入 Ctrl+C 触发中断或接收系统终止信号。

---

## 全局通用选项

CLI 顶层调度器对所有子命令统一注入通用控制选项：

- `-v, -V, --version`：打印 CLI 工具版本号并退出。
- `-h, --help`：打印命令帮助说明并退出。
- `--json`：以标准 JSON 格式输出结果。查询与执行命令（如 `list`、`run`）消费该选项。交互命令忽略该选项。发生错误时顶层统一输出 JSON 错误信封。
- `--data-dir <path>`：指定运行时数据库存储目录。涉及 SQLite 存储的命令消费该选项。该选项仅隔离运行时 SQLite 数据库。它不影响用户主目录维度的全局配置与资产。
- `ACTIONDOCK_HOME=<path>`（环境变量）：指定 ActionDock 用户根目录。该变量覆盖默认的系统用户主目录。它用于测试环境、持续集成与沙箱隔离。包含以下内容：
  - 远端执行环境配置：`<path>/.actiondock/profiles.json`
  - 全局软链接注册表：`<path>/.actiondock/registry.json`
  - 安全通信证书目录：`<path>/.actiondock/certs/`
  - 默认全局与包级数据库：`<path>/.actiondock/global.db` 与 `<path>/.actiondock/data/`

### 远程连接与目标通用选项

所有支持连接远程服务端的命令均挂载如下选项：

- `-p, --profile <name>`：指定已注册的环境配置名称。
- `-s, --server <url>`：指定远程服务基础 URL。支持 HTTP 与 HTTPS。
- `-t, --token <token>`：指定远程服务访问令牌。
- `-k, --insecure`：允许不安全的 TLS 连接。跳过自签名证书合法性校验。适用于内网部署。
- `--allow-insecure-http`：豁免非回环明文 HTTP 传输令牌的安全拦截。

---

## 全量命令速查

### 项目初始化与体检

- 项目脚手架初始化 (`ad init`)：
  ```bash
  ad init [directory] [--id <package-id>] [--name <name>] [--desc <description>]
  ```
  初始化生成包含 `actiondock.json`、`actions/`、`playbooks/` 与 `tests/` 的标准工程。

- 生成新 Action 模板代码 (`ad action create`)：
  ```bash
  ad action create <id> [-d, --desc <description>] [-f, --file <filePath>] [-i, --input <fields...>] [-o, --output <fields...>]
  ```
  在当前工程中生成新 Action 模板源码。命令在 `actiondock.json` 中自动注册契约并生成类型。
  - 参数说明：
    - `-d, --desc <description>`：Action 功能描述。
    - `-f, --file <filePath>`：指定源码文件相对于 actions 目录的相对路径。
    - `-i, --input <fields...>`：输入模式简写字段列表，格式如 `name:string, count?:number`。
    - `-o, --output <fields...>`：输出模式简写字段列表，格式如 `message:string, success:boolean`。
  - 简写语法与边界说明：
    - 支持的基础类型包括 `string`、`number`（或 `int`、`integer`）、`boolean`（或 `bool`）、`array`（或 `list`）、`object`（或 `json`）。
    - 字段名以 `?` 结尾表示该字段为可选。
    - 命令行简写仅用于快速初始化代码骨架。
    - 复杂字段与数值范围需在 `actiondock.json` 中扩展标准 JSON Schema。
    - 修改后执行 `ad generate types` 刷新类型。

- 生成新 Playbook 规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中生成新 Playbook 规程 Markdown 文件。命令在 `actiondock.json` 中自动注册该规程。

- 能力检索与意图发现 (`ad info`)：
  ```bash
  ad info [patterns...] [-i, --intent <pattern>] [--tree] [--fallback] [--no-fallback] [-P, --package <id>] [--profile <name>] [--server <url>] [--token <token>] [--data-dir <path>] [--json]
  ```
  该命令用于检索能力。支持模糊匹配、正则意图过滤与 `--tree` 打印层级依赖树。未找到匹配时在机器模式下返回空集合，退出码为 0。

- 环境诊断与体检 (`ad doctor`)：
  ```bash
  ad doctor [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  全面校验运行时环境、依赖状态、配置就绪度与全局链接有效性。`registry.duplicates` 校验诊断范围内的包 ID 是否对应多个真实目录。发现首个冲突即报告错误，命令以退出码 1 结束。冲突状态下仍可生成诊断报告。`doctor` 授权范围只控制报告对象，默认不扩大对外授权。已链接依赖在白名单外不等于缺失。依赖按完整引用定向确认，无关包冲突不产生干扰。失效路径与损坏清单不作为有效身份参与冲突。失效来源保留清理诊断。损坏来源通过宿主告警与 `registry.global` 报告。受限诊断不能确认归属时不暴露未授权物理路径。

---

### Action 开发、校验与执行

- 列出 Action 清单 (`ad list` / `ad action list`)：
  ```bash
  ad list [patterns...] [-i, --intent <pattern>] [--fallback] [--no-fallback] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  检索并列出当前包、工作区或远程服务中可用的 Action 清单。

- 查看 Action 详情与模式规范 (`ad describe` / `ad action describe`)：
  ```bash
  ad describe <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  查询指定 Action 的详情，提供四层指导：
  - 输入模式字段明细：字段名、类型、是否必填与描述信息。
  - 扁平编码指引：字符串赋值格式（`path=value`）、JSON 赋值格式（`path:=json`）与数组赋值格式（`path.0=...`）。
  - 建议赋值样例展示：基于 `inputSchema` 字段属性展示无副作用的示例数据。不生成动态命令。
  - 输出选择契约说明：清晰展示默认正文字段、标准输出与标准错误流语义。说明 `--json` 完整信封读取方式。说明 `--text-field <field>` 显式改选正文方式与同步执行边界。普通 CLI 未声明默认正文时解释通用输出规则，不嗅探私有字段。目录型入口如实描述 `content`、`text`、`message` 提取规则。不宣传其不支持的 `--text-field` 选项。

- 执行 Action (`ad run` / `ad action run`)：
  ```bash
  ad run <id> [control-options] [-- <assignments...>]
  # 或使用传统互斥选项：
  # ad run <id> [-i, --input <json> | -f, --input-file <path|->] [control-options]
  ```
  本地或远程执行指定 Action。支持 `--async` 异步启动（需远程服务支持）。
  - 协议边界：`--` 分隔符隔离控制平面与数据平面。选项如 `--text-field` 属于控制平面。Action 入参属于数据平面。
  - 原始文本输入：`--stdin-field <field>` 将标准输入完整正文原样绑定为指定顶层入参字段的字符串值。该选项适合管道传入 Markdown、CSV 或补丁等原始文本。示例如下：
    ```bash
    printf '这是一段正文' | ad run summarize --stdin-field text -- style=brief
    cat report.md | ad run render --stdin-field content
    ```
    - 语义边界：正文严格保持字符串，不猜测 JSON、数字或布尔类型。正文不剥离 BOM，不修剪首尾空白，保留换行符、引号、反斜杠与 Unicode。空标准输入绑定为空字符串，是否允许由 `inputSchema` 裁决。
    - 组合规则：该选项可与 `--` 后扁平赋值组合补充其他字段。与 `--input`、`--input-file` 严格互斥（报 `INPUT_CONFLICT`）。扁平重复赋值同名或嵌套子路径以 `INPUT_PATH_CONFLICT` 拒绝。非法字段名（如包含点分路径）以 `INVALID_FLAT_ARGUMENT` 拒绝。所有校验均发生在读取与执行前。
    - 安全边界：标准输入原始字节与最终入参序列化结果分别受默认 10MiB 上限约束。源字节超限报 `INPUT_LIMIT_EXCEEDED`。合并字段或转义后总大小超限报 `FLAT_INPUT_LIMIT_EXCEEDED`。UTF-8 校验失败报 `INPUT_FILE_READ_FAILED`。等待标准输入时可通过取消信号退出。`--text-field` 属于输出选择，可与本选项同时使用。
    - 管道非事务：Shell 管道不是事务。`pipefail` 只能反映失败，不能阻止下游已写入数据。高风险写入建议先完整生成并校验再写入。
  - 依赖按需准备与 `--no-install`：
    - 本地 `ad run` 默认按需准备依赖。主动作与快照中的本地子动作均在授权后、首次执行前按需准备依赖。
    - 若当前工程声明了正式 Action 包依赖，CLI 会先完成建图所需的首次准备，再固定宿主快照。这一步同样遵守禁装策略。仅普通 npm 依赖缺失时，未知动作不触发安装。
    - 未注入准备回调时，SDK、`ad serve` 与 `ad mcp` 不新增按需首装行为。既有事务崩溃恢复安装仍受 `allowInstall` 及 `ACTIONDOCK_AUTO_INSTALL` 环境变量控制。
    - 命令行指定 `--no-install` 或环境变量 `ACTIONDOCK_AUTO_INSTALL=false` 时，整条调用链禁止自动安装与恢复安装。系统仍会校验依赖是否就绪。智能体严禁绕过该规则。
    - `uses` 仅用于调用权限授权，不能作为安装清单。未调用的包不会单独触发准备。安装范围由根 `package.json` 与工作区配置决定。
    - 远端子动作通过对应 Profile 在远端执行。本机绝不执行远端依赖查找或安装。
    - 执行期不会动态扩大宿主包图快照。新 Action 包不会在执行期自动加入宿主。
    - 子动作依赖准备失败不会撤销父动作此前已产生的副作用。框架绝不自动重跑父动作。
    - 依赖判定以必需生产依赖元数据是否物化为依据。框架不执行业务代码，不承诺完整依赖健康校验。`optionalDependencies` 缺失不视为必须安装。
    - 若存在 `node_modules` 但必需生产依赖缺失或损坏，严禁自动重建。系统抛出 `DEPENDENCIES_NOT_READY` 并提示手动修复。目标路径位于 `node_modules` 时跳过首装，不沿符号链接进入外部目录安装。
    - 依赖安装进度输出至 stderr。标准输出 stdout 保持协议完整。安装失败、超时或取消时不启动动作，且不自动重试。
    - 本地调用指定 `--timeout` 时，同一预算覆盖建图前事务恢复、冷首装、目标包准备与动作执行。前置阶段耗尽预算报 `ACTION_TIMEOUT` 且不启动动作。中断信号归并为退出码 130。修改原始时限仍触发幂等冲突。
    - 当前工程存在待恢复事务时，CLI 在建图前先完成事务恢复。禁装策略下在任何文件修改前直接报 `PROJECT_RECOVERY_REQUIRED`。
  - 两种赋值操作符：
    - `path=value`：严格保留为字符串，不执行 JSON 解析与类型猜测。
    - `path:=json`：严格解析为 JSON 值。递归校验所有数值为有限数（`Number.isFinite`）。
  - 路径语法规则：
    - 命名段（`^[A-Za-z_][A-Za-z0-9_-]*$`）表示对象属性。
    - 纯数字段（`^(0|[1-9][0-9]*)$`）表示数组索引。数组索引必须从 0 开始连续编号，拒绝稀疏数组。
    - 根节点始终物化为对象。
    - 路径冲突（叶节点与容器冲突、对象与数组冲突、重复赋值）严格拒绝（报 `INPUT_PATH_CONFLICT`）。
    - 拦截原型污染敏感属性（`__proto__`、`constructor`、`prototype`）。
  - 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（报 `INPUT_CONFLICT`）。未指定任何输入参数时，默认传入空对象 `{}`。`--stdin-field <field>` 可与扁平参数组合。
  - 输出模式：
    - 默认纯文本输出：未指定 `--text-field` 且无声明式注解时，标量直接输出。结构化对象以标准 JSON 格式输出到 stdout。不自动嗅探私有业务字段。
    - 显式正文输出：传入 `--text-field <field>` 时，仅提取指定顶层字符串字段输出至 stdout。该模式保留真实换行与原生排版，不进行 JSON 转义。其余字段以格式化 JSON 输出至 stderr。
    - 声明式默认正文：Action 清单中声明 `annotations["actiondock.cli"] = { "textField": "<field>" }` 时，未指定 `--text-field` 的同步执行自动应用该正文输出。显式 `--text-field` 优先于默认注解。
    - 严格校验：正文字段缺失、非字符串或返回数据非对象时，输出错误并以退出码 1 退出。不静默回退，不改写执行记录。
    - 参数互斥：`--text-field` 与 `--json`、`--async` 严格互斥。执行前校验并以退出码 2 退出。
  - 机器模式：仅在需要结构化提取时追加 `--json` 选项。输出标准 JSON 结果信封（`{ "ok": true, "data": ... }`），忽略默认正文注解。业务失败时在 stdout 输出错误信封并以退出码 1 退出。参数解析出错输出错误信封并以退出码 2 退出。
  - 幂等请求标识：`--request-id <id>` 为可选的客户端幂等键，用于标记请求身份。其作用域区分为两种模式：
    - 服务模式（如 `ad serve` 或远程服务）：支持相同入参请求的幂等去重重放。服务端自动拦截重复调度并返回先前的执行结果。
    - 本地命令行模式：`--request-id` 作为关联标识与状态反查凭据。不同命令行进程分属独立实例，不会跨进程自动拦截重放。
  - 单次调用配置覆盖：`-c, --config <assignment>` 支持临时覆盖配置：
    - `-c KEY=value`：保留为纯字符串，不进行 JSON 猜测。
    - `-c KEY:=json`：按严格 JSON 解析。递归要求所有数值必须为有限数（`Number.isFinite`）。不物化路径，语法或解析出错时立即以退出码 2 退出。
  - 传统输入选项：
    - 简单输入：使用 `-i, --input <json>` 传递内联 JSON 字符串，适合简易标量入参。
    - 文件输入：使用 `-f, --input-file <path>` 从 JSON 文件读取内容并解析，适合复杂嵌套对象。
    - 标准输入：使用 `-f, --input-file -` 从标准输入读取全部内容并解析，适合跨进程管道。
    - 转义安全：复杂 JSON 推荐使用 `--input-file` 传递。文件与标准输入 JSON 在解析前剔除 UTF-8 BOM。默认输入大小上限为 10MiB。`--stdin-field` 保留正文 BOM。

- 校验 Action 模式与契约 (`ad validate` / `ad action validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  校验指定包或动作的元数据清单规范、Schema 定义与输出契约合规性。
  - 输出契约校验：静态分析 `annotations["actiondock.cli"].textField` 与 `outputSchema` 的兼容性。该分析只读取元数据。`ad validate` 会加载动作定义、校验依赖并生成类型摘要，但不会调用业务 `run`。
  - 确定矛盾拦截：注解结构非法时报告错误。正文字段非有效字符串时报告错误。Schema 拒绝对象或目标字段未声明时，均以退出码 1 退出。
  - 风险透明诊断：根类型未限定对象、字段未标记为 `required` 或 Schema 缺失时，给出警告。`--json` 模式下的诊断结果包含 `warnings` 数组。

- 自动生成 TypeScript 类型声明 (`ad generate types`)：
  ```bash
  ad generate types [--json]
  ```
  基于 `actiondock.json` 中声明的 `inputSchema` 与 `outputSchema` 自动生成 TypeScript 声明文件（`.actiondock/generated/actions.d.ts`）。

- 执行测试套件 (`ad test`)：
  ```bash
  ad test [pattern]
  ```
  调用配置的测试执行器执行测试套件。

---

### 依赖安装与包管理

- 安装并锁定依赖 (`ad add`)：
  ```bash
  ad add <package> [--allow-install-scripts] [-D, --dev] [-P, --package <path>] [--json]
  ```
  安装并锁定 Action 包依赖。命令同步更新 `package.json`、`actiondock.json` 与 `actiondock.lock.json`，受原子事务快照保护。
  中断取消（如 Ctrl-C）会终止安装进程并等待其退出。命令释放工程排他锁，事务保留 `pending` 状态，交由下一次允许安装的命令恢复。`ad remove` 取消行为一致。后续 `ad add` 或 `ad remove` 在建图与生成新快照前先完成恢复。恢复失败或取消时不继续修改。核心事务入口拒绝在未恢复事务上叠加新事务。

- 移除依赖并更新锁定 (`ad remove`)：
  ```bash
  ad remove <package> [-P, --package <path>] [--json]
  ```
  从项目中移除指定的 Action 包依赖，并同步更新 `actiondock.lock.json`。

- 打包为 npm 压缩包 (`ad pack`)：
  ```bash
  ad pack [-P, --package <id>] [-o, --out <path>] [--dry-run] [--json]
  ```
  将 Action 包打包为标准 npm 压缩包（`.tgz`）用于分发与发布。支持 `--dry-run` 预览打包摘要。

---

### 构建与技能导出

- 构建 Node.js 运行时交付目录 (`ad build`)：
  ```bash
  ad build [-P, --package <id>] [-o, --out <path>] [-a, --actions <actions...>] [-p, --playbooks <playbooks...>] [-z, --archive] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  将项目 Action 构建为可直接由 Node.js 执行的交付目录或归档包。支持通过 `--vendor-deps` 固化生产依赖。

- 导出智能体技能 (`ad export skill`)：
  ```bash
  ad export skill [-P, --package <id...>] [--workspace] [--all] [--bundle [name]] [-m, --mode <mode>] [-o, --out <path>] [-p, --playbook <playbooks...>] [-a, --actions <actions...>] [-z, --archive] [--skill-md <path>] [--custom-md <path>] [--skill-md-only] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  导出面向智能体的 Agent Skill 目录。支持 `-m, --mode source`（默认源码型）与 `-m, --mode node`（目录型）。
  单包导出与复合导出（`--bundle`）均支持 `--custom-md <path>` 指定自定义说明书。缺省时自动发现项目包根目录或工作区根目录下的同名文件。复合导出支持 `--skill-md-only` 就地重新生成复合 SKILL.md。该模式忽略已有文件，不拷贝子包产物。

---

### 规程管理

- 列出规程清单 (`ad playbook list`)：
  ```bash
  ad playbook list [patterns...] [-i, --intent <pattern>] [--no-fallback] [-P, --package <id>] [--data-dir <path>] [--json]
  ```

- 查看规程详细内容 (`ad playbook show`)：
  ```bash
  ad playbook show <id> [-P, --package <id>] [--data-dir <path>] [--json]
  ```

- 校验规程语法与引用 (`ad playbook validate`)：
  ```bash
  ad playbook validate [id] [-P, --package <id>] [--data-dir <path>] [--json]
  ```

- 生成新规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中生成新 Playbook 规程模板。

---

### 配置与状态管理

`ad config set` 与 `ad state set` 使用相同的值输入规则。独立执行入口也保持一致：

- 完整位置值：`[value]` 必须位于 `--` 前。合法 JSON 自动解码，否则保留为普通字符串。例如 `ad state set note 'a=b'` 仍写入字符串。
- 扁平对象：仅识别 `--` 后的赋值。`path=value` 保留字符串，`path:=json` 严格解析 JSON。点路径、数组、重复冲突及危险键校验均继承 `ad run`。根节点为对象。
- 完整标准输入：`--stdin` 读取全部标准输入并裁剪末尾换行符，再按 JSON 或字符串解码。空输入报告参数错误。
- 原始字段绑定：`--stdin-field <field>` 将标准输入原始文本绑定到指定顶层字段。该模式不猜测 JSON，保留换行与全部空白。空输入绑定为空字符串。字段名不得为空、包含点路径或危险键。该选项可单独使用或与扁平赋值组合。
- 互斥与失败边界：完整位置值、`--stdin` 与结构化模式互斥。`--stdin-field` 不与完整值或 `--stdin` 组合。输入模式冲突在读取或写入前退出，退出码为 2。
- 管道大小上限：管道读取受默认 10MiB 上限约束。最终对象的序列化大小也受默认 10MiB 上限约束。字段绑定只改变输入渠道，不自动加密或脱敏状态。

- 配置管理 (`ad config`)：
  ```bash
  # 列出配置项（安全视图）
  ad config list [patterns...] [-g, --global] [-P, --package <id>] [-i, --intent <pattern>] [--data-dir <path>] [--json]
  # 读取配置安全视图
  ad config get <key> [-g, --global] [-P, --package <id>] [--data-dir <path>] [--json]
  # 写入配置键值（全量替换，写前校验）
  ad config set <key> [value] [-g, --global] [-P, --package <id>] [--stdin | --stdin-field <field>] [--browser] [--data-dir <path>] [-- <assignments...>]
  # 浏览器交互式录入敏感配置
  ad config set <key> [-g, --global] [-P, --package <id>] --browser
  # 移除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>] [--data-dir <path>]
  # 查看项目配置声明模式
  ad config schema [identifier] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  - 安全脱敏与选项表现：`ad config list` 与 `ad config get` 始终返回安全脱敏数据。敏感整项在终端中展示为 `<hidden>`。未配置项展示为 `<not configured>`。系统不提供明文查看参数。原 `--reveal` 与 `--show-secrets` 已移除。需要原值请在 Action 内通过 `ctx.config.get` 读取。
  - 标准输入注入：敏感字段可从已有环境变量读取。完整对象也可从受控文件读取。示例如下：
    ```bash
    printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
    ad config set MYSQL_191 --stdin < connection.json
    ```
  - 浏览器敏感配置录入：`ad config set <key> [-g, --global] [-P, --package <id>] --browser` 通过本地临时页面录入凭据。输入渠道与存储作用域正交。写入后退出，不自动执行 Action。
    - 适用范围与目标：支持本地包级目标与全局配置（`-g/--global`）。拒绝显式远端参数（`--server` 与 `--profile`）。包级寻址失败时明确报告错误，绝不退回全局作用域。包级需匹配目标包声明。全局需匹配当前宿主所有已加载包声明。要求至少有一项顶层 `secret: true` 且显式类型均为 `string`。全局配置在多个包同名声明时共享写入。同名包级配置优先生效。
    - 参数互斥约束：`--browser` 与位置参数值、`--stdin`、`--stdin-field` 以及扁平赋值严格互斥。冲突时在读取流、启动服务与写库前以退出码 2 退出。
    - 声明模式校验：仅支持已声明且顶层为 `secret: true` 的字符串配置。拒绝未声明项、嵌套属性敏感项及非字符串声明。页面支持多行。切换展示状态不改变输入内容。保留首尾空白。不将纯数字或布尔文本自动解码。浏览器将换行符统一为 LF。需要保留原始换行编码时，使用 JSON 文件与标准输入写入。
    - 交互与安全边界：仅监听 `127.0.0.1` 随机端口。严格校验精确 Host、Origin 与一次性凭据。完整 JSON 请求体的大小上限为 64KiB。页面无第三方资源、不回显旧值，使用内容安全策略并禁止缓存。输入等待最长 5 分钟。存储阶段等待实际写入结果。
    - 存储与降级说明：敏感配置一律整键静态加密落盘。非敏感配置保持明文。本录入渠道仅接受顶层敏感字符串。嵌套敏感对象在其他渠道写入时同样整键加密。URL 片段携带临时提交权限，请勿分享链接。无法自动打开浏览器时，标准错误流提示手动打开链接并继续等待。
  - 敏感配置静态加密：敏感配置写入持久化库时自动整键加密。旧版库中的存量敏感明文在打开时自动迁移。详细机制参见[配置解析机制](config.md#敏感配置静态加密)。
  - 写入约束与校验：先组装完整值，再严格按模式校验并整键替换。缺少必填字段时报告 `CONFIG_VALUE_INVALID`。原有配置保持不变。不支持掩码数据直接回写或部分更新。
  - 拒绝通配符实键：`ad config get`、`ad config set` 与 `ad config delete` 严格拒绝包含 `*` 的实键操作。
  - 模式查看：`ad config schema` 将通配模板单独归入 `TEMPLATE` 列并统计 `matchCount`。具体配置键来源于持久化存储及固定参数覆盖。`--json` 视图中的 `source` 仅取 `override`、`package`、`global`、`env`、`default` 或 `null`。

- 状态持久化管理 (`ad state`)：
  ```bash
  # 列出状态键名
  ad state list [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [-i, --intent <pattern>] [--data-dir <path>] [--json]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>] [--json]
  # 写入状态键值（支持存活时间秒数）
  ad state set <key> [value] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--ttl <seconds>] [--stdin | --stdin-field <field>] [--data-dir <path>] [-- <assignments...>]
  # 移除状态项
  ad state delete <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>]
  # 移除状态数据
  ad state clear [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--all] [--data-dir <path>]
  ```
  - 状态写入为整键替换，不合并旧对象。Action 作用域、命名空间、复合键与 `--ttl` 规则保持不变。
  - 原始正文与补充字段可组合写入：
    ```bash
    ad state set article -n drafts --stdin-field content -- title=草稿 tags.0=笔记 < article.md
    ```
  - 状态读取展示原文，不具备配置安全视图的自动脱敏保障。请勿将状态存储用作凭据存储。

---

### 执行历史追溯

- 列出执行历史 (`ad runs list`)：
  ```bash
  ad runs list [patterns...] [-P, --package <id>] [-i, --intent <pattern>] [-a, --action <actionId>] [--channel <channel>] [--status <status>] [--offset <count>] [--with-total] [--since <time>] [--until <time>] [--root-run-id <id>] [--parent-run-id <id>] [--view <viewName>] [--request-id <id>] [-n, --limit <count>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--no-fallback] [--data-dir <path>] [--json]
  ```
  - 按来源通道过滤：`--channel <channel>` 精确筛选服务入口通道（如 `http` 或 `mcp`）。
  - 按执行状态过滤：`--status <status>` 按生命周期终态或在途状态过滤。
  - 分页与统计元数据：`--offset <count>` 跳过指定记录数。配合 `-n, --limit <count>` 实现分页。传入 `--with-total` 且指定 `--json` 时，输出分页结构体。
  - 时间与层级过滤：`--since` 与 `--until` 按执行开始时间区间筛选。`--root-run-id` 与 `--parent-run-id` 检索级联调用树。
  - 按幂等请求标识过滤：`--request-id` 可重复传入多个。框架反查关联记录。命中记录携带 `requestId` 字段。未命中时返回空集合，退出码为 0。

- 查看单次执行详情 (`ad runs show`)：
  ```bash
  ad runs show <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  执行时携带 `--request-id` 的记录在详情中展示 `Request ID` 字段。

- 阻塞等待执行终态 (`ad runs watch`)：
  ```bash
  ad runs watch [ids...] [--request-id <id>] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--resolve-timeout <duration>] [--interval <duration>] [--timeout <duration>] [-q, --quiet] [--data-dir <path>] [--json]
  ```
  阻塞等待一个或多个执行到达终态后聚合退出。
  - 执行环境解析优先：配置远端目标时直连远端服务。本地模式检索当前工程与链接包。
  - 统一轮询策略：默认间隔两秒，可通过 `--interval` 调整。全部到达终态后退出。人读模式每项执行输出一行终态摘要。等待期间每五秒输出一次未完成计数。机器模式输出聚合对象。`ok` 仅在全部成功终态时为真。
  - 超时与中断：`--timeout` 为整体时限。超时后输出当前状态并以退出码 1 结束。中断信号仅退出等待，不取消后台任务。
  - 按幂等请求标识等待：`--request-id <id>` 可多次传入，替代位置参数 runId。反查过程在轮询间隔内重试。`--resolve-timeout` 控制预算，缺省三十秒。超出预算仍未命中时报告错误并以退出码 1 结束。
  - 本地与远端差异：在本地命令行模式下，`--request-id` 仅作为关联标识使用。独立进程不会跨实例拦截重放。服务模式下支持相同入参请求的幂等去重重放。
  - 轮询机制说明：命令行工具作为独立进程直接读取 SQLite 文件。存储层不提供原生跨进程事件总线。定时只读轮询可避免常驻守护进程。

- 取消正在执行的任务 (`ad runs cancel`)：
  ```bash
  ad runs cancel <id> [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--reason <reason>]
  ```

- 移除执行记录 (`ad runs clear`)：
  ```bash
  ad runs clear [-P, --package <id>] [-a, --action <actionId>] [--status <status>] [--older-than <duration>] [--keep <count>] [--data-dir <path>] [--json]
  ```
  按包标识、动作标识、状态、时间跨度或保留条数移除执行记录。

---

### 全局工作区链接与解除

- 注册包至全局路由表 (`ad link`)：
  ```bash
  ad link [path] [-r, --recursive]
  ```
  将本地 Action 包或工作区目录挂载至开发者注册表中。跨目录调用可使用该表。工作区是包含多个子包的父目录。登记后动态发现其子包。

  身份冲突校验有效完整包 ID 与真实目录。完整 ID 精确匹配优先于短名称。同短名称但不同完整 ID 不构成冲突。按短名称匹配到当前包时仍校验该包完整 ID 冲突。失效路径和损坏清单不作为有效身份参与冲突。独立包清单修改 ID 后查询按当前清单生效。链接在注册表锁内校验已有来源与工作区内部重复。校验通过后统一同步索引。连续改名或交换 ID 不会覆盖其他有效来源。冲突时原注册表保持不变。查询与执行仍会校验链接后的动态变化。系统不按当前目录、登记顺序或版本号自动选择实现。

- 解除注册与修剪 (`ad unlink`)：
  ```bash
  ad unlink [identifier] [-p, --prune]
  ```
  `ad unlink` 支持当前完整 ID 或物理路径。命令移除同来源旧别名，不误删其他有效来源。`--prune` 自动扫描并移除失效路径。
  发生包 ID 冲突时，使用 `ad doctor` 查看来源。按提示解除多余来源，再重新链接所需来源。若重复 ID 来自同一工作区内部，应修正子包清单 ID 或移出多余目录。只解除后再重新链接同一工作区不能消除内部重复。解除工作区会同时解除其中其他包。`ad unlink` 不依赖包集合成功加载。冲突状态下按独立包目录或工作区路径仍可解除。修复后重新启动已有的服务宿主。

---

### 多环境与远程 Profile 管理

> [!NOTE]
> 环境配置统一由全局文件管理。文件物理路径为 `.actiondock/profiles.json`。命令行选项 `--data-dir` 仅对 SQLite 数据库生效。它无法用于隔离环境配置。如需隔离 profile，请通过环境变量 `ACTIONDOCK_HOME=<dir>` 重定向用户根目录。

- 列出所有环境配置 (`ad profile list`)：
  ```bash
  ad profile list [patterns...] [-i, --intent <pattern>] [--reveal] [--fallback] [--no-fallback] [--json]
  ```
  列出所有已配置的远程环境节点。支持通过 `--reveal` 明文展示敏感 Token。

- 查看环境配置详情 (`ad profile get` 或 `ad profile show`)：
  ```bash
  ad profile get <name> [--reveal] [--json]
  ad profile show <name> [--reveal] [--json]
  ```

- 添加环境配置 (`ad profile add`)：
  ```bash
  ad profile add <name> --server <url> [--token <token>] [--token-env <envVar>] [-k, --insecure] [-d, --desc <description>]
  ```
  注册远端环境节点。推荐使用 `--token-env` 引用环境变量。内网自签名服务传入 `-k, --insecure` 可忽略证书校验。

- 更新环境配置 (`ad profile update`)：
  ```bash
  ad profile update <name> [--server <url>] [--token <token>] [--token-env <envVar>] [-k, --insecure] [--no-insecure] [-d, --desc <description>]
  ```
  更新已有环境节点的地址、令牌或安全策略。

- 切换当前默认环境 (`ad profile use`)：
  ```bash
  ad profile use <name>
  # 切换回本地执行模式
  ad profile use local
  ```

- 探测远端环境连通性 (`ad profile test`)：
  ```bash
  ad profile test <name> [--json]
  ```

- 移除环境配置 (`ad profile remove`)：
  ```bash
  ad profile remove <name>
  ```

---

### 协议集成与微服务

- 启动 MCP 服务 (`ad mcp`)：
  ```bash
  # STDIO 传输模式（默认）
  ad mcp [-d, --dir <path>] [--package <package-id>] [--all] [--timeout <duration>] [--allow-insecure-http]
  # HTTP 传输微服务模式
  ad mcp serve [-p, --port <port>] [-H, --host <host>] [-t, --token <token>] [--token-env <env>] [--allow-insecure-no-auth] [--allow-insecure-http] [--allow-query-token] [--cors-origin <origin>] [--max-body <size>] [-d, --dir <path>] [--package <package-id>] [--all] [--timeout <duration>]
  ```
  - 命令入口即授权边界：命令入口显式授权执行环境。`--package` 声明整包授权白名单。`--all` 显式授权全部包。未指定 `--package` 时，命令入口显式授权本次选定环境。直接调用 MCP 库且未声明白名单时，工具清单为空。入口授权不改变执行宿主的实际边界，不是代码沙箱。

- 启动远程调度 HTTP/HTTPS 微服务 (`ad serve`)：
  ```bash
  ad serve [-H, --host <host>] [-p, --port <port>] [-t, --token <token>] [-P, --package <package-id>] [-A, --action <action-ref>] [--views-file <path>] [--views <json>] [--https] [--tls-cert <path>] [--tls-key <path>] [--tls-ca <path>] [--tls-passphrase <passphrase>] [--allow-query-token] [--management] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>] [--data-dir <path>]
  ```
  服务支持 HTTPS 模式。传入 `--https` 时自动在本地签发并复用自签名证书。传入 `--tls-cert` 与 `--tls-key` 时加载生产证书。
  - 参数说明：
    - `-P, --package <package-id>`：限制服务对外暴露的包白名单。授予所列整包全部动作。可多次指定或使用逗号分隔。未授权的包级访问返回 403 `PACKAGE_NOT_ALLOWED`。`-P '*'` 显式允许全量访问，但不开启管理端点。
    - `-A, --action <action-ref>`：限制服务对外暴露的动作白名单。仅接受 `packageId/actionId` 全限定精确引用。可多次指定或使用逗号分隔。未授权动作的详情与执行均返回 403 错误（`ACTION_FORBIDDEN`）。执行记录列表与取消同样受授权限制。内嵌 `/mcp` 端点同步过滤工具列表。
    - `--views-file <path>`：指定虚拟投影视图配置文件的路径。单个服务端口可划分多个具备独立令牌与权限的视图。文件支持对象、数组或包裹形态。同名视图按字段覆盖合并。系统不会静默移除安全字段。
    - `--views <json>`：以内联 JSON 字符串形式指定视图配置。优先级高于 `--views-file`。
    - 视图授权策略：视图以 `packageAllowlist` 与 `actionAllowlist` 声明范围。两份白名单取并集。`actionAllowlist` 仅接受全限定引用。若两份白名单均无授权，清单为空，系统拒绝执行请求。`packageAllowlist: ["*"]` 显式允许全量访问。
    - 视图独立性与默认视图：命名视图不继承默认视图的 Token 与白名单。命令行 `-P/-A` 不是所有视图的共同权限上限。默认视图在未声明授权时不暴露能力。管理员全授权视图使用 `["*"]`。持有单动作授权的包仅返回最小元数据。规程与 `doctor` 仅对整包授权开放。
    - 历史清理边界：受限授权下，`runs/clear` 需显式指定已授权的整包或单动作。禁止全局 `runs/clean-expired`。`packageAllowlist: ["*"]` 保留全局清理能力。
    - `-H, --host <host>`：服务监听地址（默认 `127.0.0.1`）。
    - `-p, --port <port>`：服务监听端口（默认 `5177`）。
    - `-t, --token <token>`：服务访问鉴权令牌。监听非回环地址时要求配置。
    - `--https`：启用 HTTPS 协议。未指定证书时自动签发并复用本地自签名证书。
    - `--tls-cert <path>`、`--tls-key <path>`：指定生产 TLS 证书与私钥路径。
    - `--allow-query-token`：允许通过 URL 查询参数 `?token=...` 传递令牌。
    - `--allow-insecure-no-auth`：允许在非回环地址下不启用令牌鉴权启动。
    - `--no-mcp`：禁用服务内嵌的 `/mcp` 协议端点。
    - `-d, --dir <path>`：指定项目根目录。缺省自动查找当前工作目录所在的工程。
    - `--data-dir <path>`：指定运行时 SQLite 数据库存储目录。

---

## 标准机器输出格式

使用 `--json` 选项执行 Action 或发生错误时，标准输出提供一致的信封包装：

### 成功信封
```json
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2...",
  "data": {
    "message": "Hello, ActionDock!"
  }
}
```

### 错误信封
```json
{
  "ok": false,
  "runId": "01JMB394K8V6C1T9A2...",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "输入参数模式校验失败",
    "details": [
      {
        "instancePath": "/name",
        "message": "must be string"
      }
    ]
  }
}
```
