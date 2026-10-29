# 参考手册：CLI 命令行速查

`ad` 是 ActionDock 2.x 的统一命令行门面工具，用于驱动 Action 与 Skill 的创建、依赖管理、能力检索、本地执行、状态配置管理、测试套件调度、目录构建、打包分发与产物导出。

---

## 统一退出码规范

ActionDock CLI 遵循确定性的退出码规范，供宿主环境、脚本与智能体精准识别执行状态：

- 退出码 0：执行成功。业务操作正常完成，或正常展示帮助与版本信息。
- 退出码 1：执行失败。包括业务逻辑执行抛错、超时中止、目标服务不可达等运行时异常。
- 退出码 2：命令行参数或选项校验失败。包括缺少必填参数、参数格式非法（如扁平参数语法错误、路径冲突、JSON 字面量非法）、输入模式冲突或存在未知选项。
- 退出码 130：进程接收外部中断信号退出。包括用户输入 Ctrl+C 触发中断或接收系统终止信号。

---

## 全局通用选项

CLI 顶层调度器对所有子命令统一注入通用控制选项：

- `-v, -V, --version`：打印 CLI 工具版本号并退出。
- `-h, --help`：打印命令帮助说明并退出。
- `--json`：以标准 JSON 格式输出结果。支持机器渲染的查询与执行命令（如 `list`、`describe`、`run`、`info`、`doctor`、`playbook show`、`validate` 等）会消费该选项；未实现机器输出的交互命令（如 `init`、`test`、`link`、`serve`、`mcp` 等）将其作为无操作选项忽略，不影响人类可读输出；发生异常时无论何种命令均统一由顶层错误处理器输出 JSON 错误信封。
- `--data-dir <path>`：指定运行时数据库存储目录。由涉及 SQLite 持久化与状态存储的命令消费（包级运行时数据库 `<path>/<package-id>/runtime.db`、全局共享数据库 `<path>/global.db` 与目录排他锁 `<path>/.actiondock.data.lock`）。请注意本选项仅隔离运行期 SQLite 数据库，不影响属于用户主目录维度的全局配置与资产（如环境配置、软链接注册表及证书）。
- `ACTIONDOCK_HOME=<path>`（环境变量）：指定 ActionDock 用户根目录（覆盖默认的系统用户主目录）。用于实现测试环境、持续集成及沙箱场景下的彻底隔离。包含以下内容：
  - 远端执行环境配置：`<path>/.actiondock/profiles.json`
  - 全局软链接注册表：`<path>/.actiondock/registry.json`
  - 安全通信证书目录：`<path>/.actiondock/certs/`
  - 默认全局与包级数据库：`<path>/.actiondock/global.db` 与 `<path>/.actiondock/data/`（在未显式传入 `--data-dir` 时生效）

### 远程连接与目标通用选项

所有支持连接远程 ActionDock 服务端的命令（包括 `run`、`runs`、`state`、`config`、`doctor`、`info`、`list`、`describe`、`playbook` 等）均由统一逻辑（`applyTargetOptions`）挂载如下选项：

- `-p, --profile <name>`：指定已注册的环境配置名称。
- `-s, --server <url>`：指定远程服务基础 URL（支持 HTTP 与 HTTPS）。
- `-t, --token <token>`：指定远程服务访问令牌。
- `-k, --insecure`：允许不安全的 TLS 连接，跳过对自签名或私有证书的合法性校验（适用于内网部署）。
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
  在当前工程中脚手架生成新 Action 模板源码并在 `actiondock.json` 中自动注册契约与生成类型。
  - 参数说明：
    - `-d, --desc <description>`：Action 功能描述。
    - `-f, --file <filePath>`：指定源码文件相对于 actions 目录的相对路径。
    - `-i, --input <fields...>`：输入模式简写字段列表，格式如 `name:string, count?:number`。
    - `-o, --output <fields...>`：输出模式简写字段列表，格式如 `message:string, success:boolean`。
  - 简写语法与边界说明：
    - 支持的基础类型包括 `string`、`number`（或 `int`、`integer`）、`boolean`（或 `bool`）、`array`（或 `list`）、`object`（或 `json`）。
    - 字段名以 `?` 结尾表示该字段为可选。
    - 命令行简写仅用于快速初始化代码骨架；深层嵌套属性、字段说明、枚举取值、正则校验、数值范围等复杂语义规范，需在 `actiondock.json` 中扩展标准 JSON Schema，并运行 `ad generate types` 刷新类型。

- 生成新 Playbook 规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中脚手架生成新 Playbook 规程 Markdown 文件并在 `actiondock.json` 中自动注册。

- 能力检索与意图发现 (`ad info`)：
  ```bash
  ad info [patterns...] [-i, --intent <pattern>] [--tree] [--fallback] [--no-fallback] [-P, --package <id>] [--profile <name>] [--server <url>] [--token <token>] [--data-dir <path>] [--json]
  ```
  智能体与开发者能力发现的首选入口。支持模糊匹配、正则意图过滤以及通过 `--tree` 打印层级依赖树。未找到匹配时在机器模式下返回空结果集合并保持退出码 0。

- 环境诊断与体检 (`ad doctor`)：
  ```bash
  ad doctor [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  全面检查运行时环境、依赖状态、配置就绪度及全局链接有效性。`registry.duplicates` 检查诊断范围内的包 ID 是否对应多个真实目录，发现首个冲突即报告错误，命令以退出码 1 结束；冲突状态下仍可生成诊断报告。`doctor` 授权范围只控制报告对象，默认不扩大对外授权；已链接依赖在白名单外不等于缺失，依赖按完整引用定向确认，无关包冲突不干扰。失效路径与损坏清单不作为有效身份参与冲突，失效来源保留清理诊断，损坏来源（含新扫描出的无缓存坏清单）通过宿主告警与 `registry.global` 报告，受限诊断不能确认归属时不暴露未授权物理路径。

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
  作为编码顾问查询指定 Action 的详情，提供四层指导：
  - 输入模式字段明细：字段名、类型、是否必填与描述信息。
  - Flat 编码指引：字符串赋值格式（`path=value`）、JSON 标量与结构赋值格式（`path:=json`）与数组元素赋值格式（`path.0=...`）。
  - 建议赋值样例展示：基于 `inputSchema` 字段属性呈现无副作用的赋值示例数据，不生成动态可执行命令。
  - 输出选择契约说明：清晰展示默认正文字段、stdout 与 stderr 通道语义、`--json` 完整信封读取方式、`--text-field <field>` 显式改选正文方式及仅适用于同步执行的边界。普通 CLI 未声明默认正文时解释通用输出规则，不嗅探私有字段；目录型入口如实描述现有 `content`、`text`、`message` 提取规则，不宣传其不支持的 `--text-field` 选项。

- 执行 Action (`ad run` / `ad action run`)：
  ```bash
  ad run <id> [control-options] [-- <assignments...>]
  # 或使用传统互斥选项：
  # ad run <id> [-i, --input <json> | -f, --input-file <path|->] [control-options]
  ```
  本地或远程执行指定 Action，支持 `--async` 异步启动（需远程服务支持）。
  - 协议边界：`--` 分隔符作为控制平面（ActionDock 选项如 `--text-field`、`--json`、`--config`、`--data-dir`、`--profile`、`--timeout` 等）与数据平面（Action 入参）的协议边界。
  - 原始文本输入：`--stdin-field <field>` 将 stdin 完整正文（至 EOF）原样绑定为指定顶层入参字段的字符串值，适合管道传入 Markdown、CSV、补丁等原始文本。下例假定 `summarize` 与 `render` 是已注册且具有相应字符串入参的示例动作：
    ```bash
    printf '这是一段正文' | ad run summarize --stdin-field text -- style=brief
    cat report.md | ad run render --stdin-field content
    ```
    - 语义边界：正文严格保持字符串，不猜测 JSON、数字或布尔类型；不剥离 BOM、不修剪首尾空白，保留 CRLF、引号、反斜杠与 Unicode；空 stdin 绑定为空字符串，是否允许由 `inputSchema` 裁决。
    - 组合规则：可与 `--` 后扁平赋值组合补充其他字段；与 `--input`、`--input-file`（含 `-`）严格互斥（`INPUT_CONFLICT`）；flat 重复赋值同名或嵌套子路径以 `INPUT_PATH_CONFLICT` 拒绝；非法字段名（空、含点分路径、危险属性）以 `INVALID_FLAT_ARGUMENT` 拒绝，均发生在读取与执行前。
    - 安全边界：stdin 原始字节与最终入参序列化结果分别受默认 10MiB 上限约束。源字节超限报 `INPUT_LIMIT_EXCEEDED`，合并字段或 JSON 转义后总大小超限报 `FLAT_INPUT_LIMIT_EXCEEDED`；严格 UTF-8 校验失败报 `INPUT_FILE_READ_FAILED`，不是 JSON 解析失败。等待 stdin 时可通过取消信号退出；`--text-field` 是输出选择，可与本选项同时使用。
    - 管道非事务：普通 shell 管道不是事务，`pipefail` 只能反映失败不能阻止下游已写入；高风险导入、发评论、部署建议先完整生成并校验再写入。
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
  - 两种赋值操作符：
    - `path=value`：严格保留为字符串，不执行 JSON 解析与类型猜测。
    - `path:=json`：严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
  - 路径语法规则：
    - 命名段（`^[A-Za-z_][A-Za-z0-9_-]*$`）表示对象属性。
    - 纯数字段（`^(0|[1-9][0-9]*)$`）表示数组索引，数组索引必须从 0 开始连续编号，拒绝稀疏数组。
    - 根节点始终物化为对象。
    - 路径冲突（叶节点与容器冲突、对象与数组冲突、重复赋值）严格拒绝（`INPUT_PATH_CONFLICT`）。
    - 拦截原型污染敏感属性（`__proto__`、`constructor`、`prototype`）。
  - 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）；未指定任何输入参数时，默认传入空对象 `{}`。另有独立的原始文本绑定 `--stdin-field <field>` 可与扁平参数组合，详见上文。
  - 输出模式：
    - 默认纯文本输出：未指定 `--text-field` 且无声明式注解时，标量直接输出，结构化对象以标准 JSON 格式输出到 stdout，不进行私有业务字段自动嗅探。
    - 显式正文输出：传入 `--text-field <field>` 时，仅提取结果中指定顶层自有字符串字段输出至 stdout（保留真实换行与原生排版，不进行 JSON 转义），其余字段以格式化 JSON 对象输出至 stderr（无多余字段时不输出）。
    - 声明式默认正文：Action 清单中声明 `annotations["actiondock.cli"] = { "textField": "<field>" }` 时，未指定 `--text-field` 的同步执行自动应用该正文与元数据输出行为；显式 `--text-field` 优先于默认注解。
    - 严格校验：正文字段缺失、非字符串或返回数据非对象时，明确输出错误并以退出码 1 退出，不静默回退，不改写运行记录。
    - 参数互斥：`--text-field` 与 `--json`、`--async` 严格互斥，在执行前校验并以退出码 2 退出。
  - 机器模式：仅在需要结构化提取（按 `error.code` 自愈、程序化消费完整字段）时才追加 `--json` 选项；输出标准 JSON 结果信封（`{ "ok": true, "data": ... }`），忽略默认正文注解；业务失败时在 stdout 输出错误信封（`{ "ok": false, "error": ... }`）并以退出码 1 退出；若参数解析出错输出标准错误信封并以退出码 2 退出。
  - 幂等请求标识：`--request-id <id>` 为可选的客户端幂等键，用于标记请求身份。其作用域区分为两种模式：
    - 在统一服务实例与远程常驻服务模式（如 `ad serve` 或远程服务）下，支持相同入参请求的幂等去重重放，服务端会自动拦截重复调度并返回先前的执行结果。
    - 在独立的本地命令行进程模式下，`--request-id` 主要作为关联标识与状态反查凭据（供 `ad runs list --request-id` 过滤与 `ad runs watch --request-id` 精准对因反查）。不同独立本地命令行进程分属独立进程实例，不会跨进程自动拦截重放。
  - 单次调用配置覆盖：`-c, --config <assignment>` 支持临时覆盖配置：
    - `-c KEY=value`：保留为纯字符串，不进行 JSON 猜测。
    - `-c KEY:=json`：按严格 JSON 解析，递归要求所有数值必须为有限数（`Number.isFinite`）；不物化路径，语法或解析出错时立即以退出码 2 退出。独立运行分发入口具有完全相同的语义。
  - 传统输入选项：
    - 简单输入：使用 `-i, --input <json>` 传递内联 JSON 字符串，适合简易标量入参。
    - 文件输入：使用 `-f, --input-file <path>` 从 JSON 文件读取内容并解析，适合复杂多层嵌套对象。
    - 标准输入：使用 `-f, --input-file -` 从标准输入读取全部内容并解析，适合跨进程管道与持续集成脚本。
    - 转义安全：复杂 JSON 推荐优先使用 `--input-file` 传递，避免终端引号转义损坏。文件与 stdin JSON 在解析前剔除 UTF-8 BOM，默认输入大小上限为 10MiB；改用文件不会解除大小限制。`--stdin-field` 则保留正文 BOM。

- 校验 Action 模式与契约 (`ad validate` / `ad action validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  校验指定包或动作的元数据清单规范、输入输出 Schema 定义与输出契约合规性。
  - 输出契约校验：静态分析 `annotations["actiondock.cli"].textField` 与 `outputSchema` 的兼容性，新增分析自身只读取元数据。`ad validate` 的其他检查仍会加载动作定义、检查依赖和生成类型摘要，但不会调用业务 `run`。
  - 确定矛盾拦截：注解结构非法、正文字段声明非有效字符串、Schema 明确拒绝对象或字符串正文字段、目标字段未声明且没有 `patternProperties` 约束并禁止额外属性时，报告错误并以退出码 1 退出。
  - 风险透明诊断：根类型未明确限定对象或允许其他类型、字段未标记为 `required` 或不能保证字符串、Schema 缺失、包含复杂组合或字段可能由 `patternProperties` 约束时，给出警告而不误拒合法结果。`--json` 下各动作的诊断结果可包含 `warnings` 数组。

- 自动生成 TypeScript 类型声明 (`ad generate types`)：
  ```bash
  ad generate types [--json]
  ```
  基于 `actiondock.json` 中声明的 `inputSchema` 与 `outputSchema` 自动生成强类型 TypeScript 声明文件（`.actiondock/generated/actions.d.ts`）。

- 运行测试套件 (`ad test`)：
  ```bash
  ad test [pattern]
  ```
  调用配置的测试运行器执行测试套件。

---

### 依赖安装与包管理

- 安装并锁定依赖 (`ad add`)：
  ```bash
  ad add <package> [--allow-install-scripts] [-D, --dev] [-P, --package <path>] [--json]
  ```
  安装并锁定 Action 包依赖，同步更新 `package.json`、`actiondock.json` 与 `actiondock.lock.json`，受原子事务快照保护。
  中断取消（如 Ctrl-C）会终止安装进程并等待其退出、释放工程排他锁，事务保留 `pending` 状态交由下一次允许安装的持有者命令恢复；`ad remove` 取消行为一致。后续 `ad add` 或 `ad remove` 在读取清单、检查依赖与创建新快照前先完成恢复；恢复失败或被取消时不继续修改，核心事务入口也拒绝在未恢复事务上叠加新事务。

- 移除依赖并更新锁定 (`ad remove`)：
  ```bash
  ad remove <package> [-P, --package <path>] [--json]
  ```
  从项目中移除指定的 Action 包依赖，并同步更新 `actiondock.lock.json`。

- 打包为 npm 压缩包 (`ad pack`)：
  ```bash
  ad pack [-P, --package <id>] [-o, --out <path>] [--dry-run] [--json]
  ```
  将 Action 包打包为标准 npm 压缩包（`.tgz`）用于分发与发布，支持 `--dry-run` 预览打包摘要。

---

### 构建与技能导出

- 构建 Node.js 运行时交付目录 (`ad build`)：
  ```bash
  ad build [-P, --package <id>] [-o, --out <path>] [-a, --actions <actions...>] [-p, --playbooks <playbooks...>] [-z, --archive] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  将项目 Action 构建为可直接由 Node.js 运行的交付目录或压缩归档包。支持通过 `--vendor-deps` 固化生产依赖。

- 导出智能体技能 (`ad export skill`)：
  ```bash
  ad export skill [-P, --package <id...>] [--workspace] [--all] [--bundle [name]] [-m, --mode <mode>] [-o, --out <path>] [-p, --playbook <playbooks...>] [-a, --actions <actions...>] [-z, --archive] [--skill-md <path>] [--custom-md <path>] [--skill-md-only] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  导出面向智能体的 Agent Skill 目录。支持 `-m, --mode source`（默认源码型）与 `-m, --mode node`（自包含 Node.js 目录型）。
  单包导出与复合导出（`--bundle`）均支持 `--custom-md <path>` 指定自定义说明书（`SKILL.custom.md`，含插槽段落与可选 description 覆盖；缺省时自动发现项目包根目录或工作区根目录/当前目录下的同名文件）；复合导出支持 `--skill-md-only` 就地仅重生成复合 SKILL.md（始终重新生成，忽略已有 SKILL.md，不拷贝子包产物）。

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

- 创建新规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中创建新 Playbook 规程模板。

---

### 配置与状态管理

`ad config set` 与 `ad state set` 使用相同的值输入规则，独立运行入口也保持一致：

- 完整位置值：`[value]` 必须位于 `--` 前；合法 JSON 自动解码（支持根数组与标量），否则保留为普通字符串。例如 `ad state set note 'a=b'` 仍写入字符串，不猜测为扁平赋值。
- 扁平对象：仅识别 `--` 后的赋值，`path=value` 保留字符串，`path:=json` 严格解析 JSON；点路径、从 0 开始的连续数组、重复或结构冲突及危险键检查均继承 `ad run`，根节点为对象。
- 完整标准输入：`--stdin` 读取全部 stdin，裁剪末尾 CR/LF，再按 JSON 或普通字符串解码；空输入报参数错误。配置原有语义不变，状态也支持此方式。
- 原始字段绑定：`--stdin-field <field>` 将 stdin 原始文本绑定到指定顶层字段，不猜测 JSON，保留 BOM、换行与全部空白，空输入绑定为空字符串。字段名不得为空、包含点路径或危险键；可单独使用或与 `--` 后扁平赋值组合。
- 互斥与失败边界：完整位置值、`--stdin`、结构化模式（扁平赋值及字段绑定）互斥；`--stdin-field` 不与完整值或 `--stdin` 组合。输入模式冲突、赋值解析与路径错误在读取 stdin 或写入前以参数错误退出，退出码为 2，不吞错或部分写入。
- 管道读取沿用默认 10MiB 源字节上限与取消语义；字段绑定后最终对象的序列化大小也受默认 10MiB 上限约束，补充字段与 JSON 转义放大均计入大小。字段绑定只改变输入渠道，不自动加密或脱敏状态。

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
  # 删除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>] [--data-dir <path>]
  # 查看项目配置声明模式
  ad config schema [identifier] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  - 安全脱敏与选项表现：`ad config list` 与 `ad config get` 始终返回安全脱敏数据。敏感整项在终端中展示为 `<hidden>`，未配置项展示为 `<not configured>`。系统不提供任何明文查看参数，原 `--reveal` 与 `--show-secrets` 已移除；需要原值请在 Action 内通过 `ctx.config.get` 读取。
  - 标准输入注入：敏感字段可从已有环境变量读取，完整对象也可从受控文件读取，避免把真实密码直接写入命令文本：
    ```bash
    printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
    ad config set MYSQL_191 --stdin < connection.json
    ```
  - 浏览器敏感配置录入：`ad config set <key> [-g, --global] [-P, --package <id>] --browser` 通过本地临时页面录入凭据，不经命令参数或模型对话传递；输入渠道与保存作用域正交，保存后退出，不自动执行 Action。
    - 适用范围与目标：支持本地包级目标与全局配置（`-g/--global`），拒绝显式远端参数（`--server` 与 `--profile`）以及默认激活 Profile 决议出的隐式远端目标；包级寻址失败时明确报错，绝不退回全局作用域。包级需匹配目标包声明，全局需匹配当前宿主所有已加载包声明，要求至少有一项顶层 `secret: true` 且所有显式类型均为 `string`。全局配置在多个包同名声明时共享写入，同名包级配置优先生效。
    - 参数互斥约束：`--browser` 与位置参数值、`--stdin`、`--stdin-field` 以及 `--` 分隔符后的结构化赋值严格互斥（包含显式空分隔符 `--`），冲突时在读取流、启动服务与写库前以退出码 2 退出。
    - 声明模式校验：仅支持已声明且顶层为 `secret: true` 的字符串配置；拒绝未声明项、仅嵌套属性敏感项及非字符串声明；无显式类型的顶层敏感配置可按字符串输入。页面支持多行，显示与隐藏切换不改变输入内容；保留首尾空白，不将 `123`、`false` 或 JSON 外观文本自动解码。浏览器将 CR 与 CRLF 换行统一为 LF；需要保留原始换行编码时，使用包含转义换行的 JSON 字符串，例如通过 `ad config set <key> --stdin < secret.json` 写入受控文件中的完整 JSON 字符串。
    - 交互与安全边界：仅监听 `127.0.0.1` 随机端口，严格校验精确 Host、Origin（POST 缺失 Origin 直接拒绝）与一次性凭据，完整 JSON 请求体的 UTF-8 大小最大为 64KiB；超限时明确提示，可缩短内容重试或取消。页面无第三方资源、不回显旧值，使用内容安全策略并禁止缓存。输入等待自创建起最多 5 分钟，校验失败或请求体超限不重置期限；等待时可页面取消或终端中断，一旦进入保存阶段则等待实际写入结果，不再取消或超时打断。
    - 存储与降级说明：声明判定敏感的配置一律整键静态加密落盘，仅非敏感配置保持明文；本录入渠道自身仍只接受顶层敏感字符串，这是输入资格限制，不影响其他输入渠道写入的嵌套敏感对象同样整键加密。静态加密不构成对已授权 Action 或本机程序的秘密隔离。URL 片段携带临时提交权限，请勿分享链接；无法确认自动打开浏览器成功时，标准错误流提示手动打开链接并继续等待。
  - 敏感配置静态加密：声明判定敏感的配置键写入持久化库时自动整键加密，旧版库的存量敏感明文在打开时自动迁移，无需任何迁移命令。完整语义、密钥管理与回退流程见 [配置解析机制](config.md#敏感配置静态加密)。
  - 写入约束与校验：先组装完整值，再严格按模式校验并整键替换；缺少密码等必填字段时也会报 `CONFIG_VALUE_INVALID`，原有配置保持不变。不支持掩码数据直接回写、部分更新与对象合并，扁平赋值也不是局部更新。
  - 拒绝通配符实键：`ad config get`、`ad config set` 与 `ad config delete` 严格拒绝包含 `*` 的实键操作。
  - 模式查看：`ad config schema` 将通配模板单独归入 `TEMPLATE` 列并统计 `matchCount`，不判定缺失。具体配置键仅来源于持久化存储及固定参数覆盖，不枚举仅在环境变量中存在的模板实例。`--json` 视图中的 `source` 与核心 `ConfigSource` 契约一致，仅取 `override`、`package`、`global`、`env`、`default` 或 `null`（未命中），临时覆盖可见为 `override`，不再使用 `project` 或 `remote` 别名。

- 状态持久化管理 (`ad state`)：
  ```bash
  # 列出状态键名
  ad state list [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [-i, --intent <pattern>] [--data-dir <path>] [--json]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>] [--json]
  # 写入状态键值（支持存活时间秒数）
  ad state set <key> [value] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--ttl <seconds>] [--stdin | --stdin-field <field>] [--data-dir <path>] [-- <assignments...>]
  # 删除状态项
  ad state delete <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>]
  # 清空状态数据
  ad state clear [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--all] [--data-dir <path>]
  ```
  - 状态写入仍为整键替换，不合并旧对象；`-a` Action 作用域、`-n` 命名空间、`ns:key` 复合键与 `--ttl` 规则不变。
  - 原始正文与补充字段可组合写入：
    ```bash
    ad state set article -n drafts --stdin-field content -- title=草稿 tags.0=笔记 < article.md
    ```
  - 状态读取可能显示原文，不具有配置安全视图的自动脱敏保障；不要因使用 stdin 就将状态视为凭据存储。

---

### 运行历史追溯

- 列出执行历史 (`ad runs list`)：
  ```bash
  ad runs list [patterns...] [-P, --package <id>] [-i, --intent <pattern>] [-a, --action <actionId>] [--channel <channel>] [--status <status>] [--offset <count>] [--with-total] [--since <time>] [--until <time>] [--root-run-id <id>] [--parent-run-id <id>] [--view <viewName>] [--request-id <id>] [-n, --limit <count>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--no-fallback] [--data-dir <path>] [--json]
  ```
  支持按来源通道过滤：`--channel <channel>` 可精准筛选服务入口通道（如 `http` 或 `mcp`）。
  支持按执行状态过滤：`--status <status>` 可按生命周期终态或在途状态过滤（如 `success`、`failed`、`running`）。
  支持分页与统计元数据：`--offset <count>` 可跳过指定记录数，配合 `-n, --limit <count>` 实现可靠分页；指定 `--with-total` 且传入 `--json` 时，输出格式由数组扩展为包含 `total`、`items`、`limit`、`offset` 的分页结构体。
  支持时间与层级过滤：`--since` 与 `--until` 支持按执行开始时间区间筛选；`--root-run-id` 与 `--parent-run-id` 支持关联检索级联调用树。
  支持按幂等请求标识过滤：`--request-id` 可重复传入多个，框架经 idempotency_keys 反查关联的运行记录（仅限当前包范围），命中记录在列表与机器模式输出中携带 `requestId` 字段。未命中时返回空集合且退出码为 0。

- 查看单次执行详情 (`ad runs show`)：
  ```bash
  ad runs show <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```
  执行时携带 `--request-id` 的记录在详情中同样展示 `Request ID` 字段。

- 阻塞等待运行终态 (`ad runs watch`)：
  ```bash
  ad runs watch [ids...] [--request-id <id>] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--resolve-timeout <duration>] [--interval <duration>] [--timeout <duration>] [-q, --quiet] [--data-dir <path>] [--json]
  ```
  阻塞等待一个或多个运行到达终态后聚合退出。主要面向本地场景：本地 shell 并发起多个 `ad run` 后台进程后，用一条 watch 命令阻塞到全部终态再收结果。执行环境解析优先（显式配置远端目标时严格直连远端服务；本地模式检索当前工程及已注册链接包，显式指定 `--package` 时严格隔离在目标包范围内）。等待策略为统一轮询（缺省间隔两秒，`--interval` 可调），全部终态即退出。人读模式每运行输出一行终态摘要，等待期间每五秒输出一次未完成计数（`--quiet` 关闭）；机器模式结束时输出聚合对象，`ok` 仅在全部终态且全部执行成功时为真。`--timeout` 为整体上限，超时后输出未终态运行的当前状态并以退出码 1 结束，不会取消任务；中断信号同样仅退出等待，不取消任何任务。

  按幂等请求标识等待：`--request-id <id>` 可多次传入（可重复选项），替代位置参数 runId 语义（两者可混用）。语法形态与 `ad runs list` 保持一致，避免选项参数对后续位置参数产生吞噬。典型场景是主控以 nohup 后台派工后拿不到 runId：派工命令携带 `--request-id` 预置标识，主控随后以同标识 watch 等待。反查过程按轮询间隔带有限重试（`--resolve-timeout` 控制预算，缺省三十秒），因为派工进程写入幂等键可能晚于 watch 启动；超出预算仍未命中时报错提示该 requestId 不存在并以退出码 1 结束。反查命中的作用域即为后续轮询归属（本地或远端），聚合输出的逐运行条目携带 `requestId` 字段便于结果对因。需要说明的是，在独立的本地命令行进程模式下，`--request-id` 主要作为关联标识与状态反查凭据使用，各独立进程不会跨实例自动拦截重放；在统一服务实例与远程常驻服务模式下则支持相同入参请求的幂等去重重放。

  轮询等待机制与事件协作权衡：ActionDock 核心规范坚持事件驱动协作原则，但在命令行运行观察场景采用只读轻量轮询，是基于客观物理与系统边界约束推导的最优解。命令行工具作为独立的短暂只读旁观进程直接连接本地 SQLite 存储文件，任务宿主进程与观察进程分属完全独立的操作系统进程，SQLite 单文件存储层缺乏原生跨进程事件总线与推送能力；ActionDock 坚持零守护进程架构哲学，不强制要求常驻事件服务器或后台中继；通过带瞬态错误容忍的轻量级定时只读轮询获取最新记录，既保障了零常驻进程的轻量性，又实现了高度的跨平台稳定性与可靠性。

- 取消正在运行的任务 (`ad runs cancel`)：
  ```bash
  ad runs cancel <id> [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--reason <reason>]
  ```

- 清理执行记录 (`ad runs clear`)：
  ```bash
  ad runs clear [-P, --package <id>] [-a, --action <actionId>] [--status <status>] [--older-than <duration>] [--keep <count>] [--data-dir <path>] [--json]
  ```
  按包标识、动作标识、状态、时间保留跨度（如 `14d`、`7d`、`24h`、`30m`）或最新保留条数（`--keep`）精确清理执行记录。

---

### 全局工作区链接与解除

- 注册包至全局路由表 (`ad link`)：
  ```bash
  ad link [path] [-r, --recursive]
  ```
  将本地 Action 包或工作区目录挂载至开发者注册表中，供跨目录调用。工作区是包含多个 ActionDock 子包的父目录，登记后动态发现其子包。

  身份冲突比较有效完整包 ID 与真实目录，完整 ID 精确匹配优先于短名称；同短名称但不同完整 ID 不构成 `PACKAGE_ID_CONFLICT`，按短名称匹配到当前包时仍检查该包完整 ID 冲突。失效路径和损坏清单不作为有效身份参与冲突。独立包清单改 ID 后查询按当前清单生效；链接在注册表锁内检查已有来源与本次工作区内部重复，通过后统一同步索引；连续改名或交换 ID 不会覆盖其他有效来源，冲突时原注册表保持不变，不残留部分包或新增工作区。查询与执行仍会检查链接后的动态变化，不按当前目录、登记顺序或版本号自动选择实现。

- 解除注册与修剪 (`ad unlink`)：
  ```bash
  ad unlink [identifier] [-p, --prune]
  ```
  `ad unlink` 支持当前完整 ID 或物理路径，清除同来源旧别名且不误删其他有效来源；`--prune` 自动扫描并移除失效的无效路径。发生包 ID 冲突时，用 `ad doctor` 查看来源，按提示执行 `ad unlink "多余工作区根目录"` 或解除多余的独立包目录，再重新链接所需来源。若重复 ID 来自同一工作区内部，应修正子包清单 ID 或移出多余目录，只解除后再重新链接同一工作区不能消除内部重复。解除工作区会同时解除其中其他包；只解除子包记录不能阻止动态重新发现。`ad unlink` 不依赖包集合成功加载，冲突状态下按独立包目录或工作区根路径仍可解除；修复后重新启动已有的 `serve`、MCP 等常驻宿主。

---

### 多环境与远程 Profile 管理

> [!NOTE]
> 环境配置统一由全局文件管理（物理路径为用户根目录下的 `.actiondock/profiles.json`）。命令行选项 `--data-dir` 仅针对运行期 SQLite 数据库生效，无法用于隔离环境配置。若需在自动化测试或隔离环境中隔离 profile，请通过环境变量 `ACTIONDOCK_HOME=<dir>` 重定向整个用户根目录。

- 列出所有环境配置 (`ad profile list`)：
  ```bash
  ad profile list [patterns...] [-i, --intent <pattern>] [--reveal] [--fallback] [--no-fallback] [--json]
  ```
  列出所有已配置的远程环境节点，支持通过 `--reveal` 明文展示敏感 Token。

- 查看环境配置详情 (`ad profile get` 或 `ad profile show`)：
  ```bash
  ad profile get <name> [--reveal] [--json]
  ad profile show <name> [--reveal] [--json]
  ```

- 添加环境配置 (`ad profile add`)：
  ```bash
  ad profile add <name> --server <url> [--token <token>] [--token-env <envVar>] [-k, --insecure] [-d, --desc <description>]
  ```
  注册远端环境节点，推荐使用 `--token-env` 引用环境变量以提升安全性。对于内网自签名证书服务，传入 `-k, --insecure` 可忽略证书合法性校验。

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
  - 命令入口即授权边界：`ad mcp` 的选定运行环境由命令入口显式授权，无需另设一套普通用户模式。`--package` 声明包授权白名单（授予整包能力），`--all` 显式授权选定运行环境中的全部包；未指定 `--package` 时，命令入口也会显式授权本次选定环境。直接调用 MCP 库且未声明白名单时，工具清单为空。入口授权不改变执行宿主已装载能力的实际边界，也不是 Action 代码沙箱。

- 启动远程调度 HTTP/HTTPS 微服务 (`ad serve`)：
  ```bash
  ad serve [-H, --host <host>] [-p, --port <port>] [-t, --token <token>] [-P, --package <package-id>] [-A, --action <action-ref>] [--views-file <path>] [--views <json>] [--https] [--tls-cert <path>] [--tls-key <path>] [--tls-ca <path>] [--tls-passphrase <passphrase>] [--allow-query-token] [--management] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>] [--data-dir <path>]
  ```
  原生支持 HTTPS 运行。仅传入 `--https` 时自动在本地签发并复用自签名 X.509 证书；传入 `--tls-cert` 与 `--tls-key` 时加载指定的生产机构证书。
  - 参数说明：
    - `-P, --package <package-id>`：限制服务对外暴露的 Action Package 授权白名单，授予所列整包当前与未来全部动作，可多次指定或使用逗号分隔（例如 `-P pkg-a,pkg-b` 或 `-P pkg-a -P pkg-b`）。该项授予所列包的整包能力，另有 `-A` 授权时按并集补充动作。RESTful API 与统一内嵌 `/mcp` 使用同一策略，未获授权的包级访问返回 403 `PACKAGE_NOT_ALLOWED`。`-P '*'` 为显式全量访问标记（不支持其他通配模式），仍不自动开启管理端点。
    - `-A, --action <action-ref>`：限制服务对外暴露的动作授权白名单，仅接受 `packageId/actionId` 全限定精确引用，拒绝短名与通配符，可多次指定或使用逗号分隔（例如 `-A pkg-a/action-1,pkg-b/action-2`）。与 `-P` 的包授权取并集；只想暴露某包单动作时只写 `-A`，不声明整包。未授权动作的详情与执行均返回 403 错误（错误码 `ACTION_FORBIDDEN`）；历史运行记录列表、单次详情与取消同样受授权限制；统一内嵌 `/mcp` 端点的工具列表与任务扩展同步过滤。
    - `--views-file <path>`：指定包含虚拟投影视图配置的 JSON 外部文件路径。支持在单个服务监听端口上划分出多个具备独立鉴权令牌、授权策略、管理权限门禁与专属 MCP 端点的视图。文件格式支持视图字典对象、数组形态或包裹形态。合并优先级高于 `actiondock.json` 中的 `server.views`；同名视图按字段覆盖合并，显式提供的字段整项替换基础侧取值，未提供的字段保留基础取值，安全字段不会被静默删除。
    - `--views <json>`：以 JSON 字符串形式直接内联指定虚拟投影视图配置。合并优先级高于 `--views-file`。
    - 视图授权策略（并集）：视图以 `packageAllowlist` 与 `actionAllowlist` 声明授权范围，两份白名单取并集，最小可用示例为 `"packageAllowlist": ["pkg-a"]` 加 `"actionAllowlist": ["pkg-b/read"]`，表示 pkg-a 整包可用（含未来新增动作）且 pkg-b 仅 `read` 单动作可见可用。`actionAllowlist` 仅接受 `packageId/actionId` 全限定精确引用，不支持短名与通配符；只想授权单动作时只写 `actionAllowlist`，不声明整包。某一白名单省略或为空数组只表示不增加该项授权，不会取消另一白名单的有效授权；两份白名单均无授权时，包与动作清单为空，执行请求被拒绝。`packageAllowlist: ["*"]` 为显式全量访问标记（不支持其他通配模式），仍不自动开启 `enableManagement`。整包授权有意覆盖未来新增动作，评估暴露面时需将其视为该视图的永久授权面。
    - 视图独立性与默认视图：命名视图不继承默认视图的 Token 与白名单，命令行 `-P/-A` 不是所有视图的共同权限上限。默认视图在未声明授权时不暴露包与动作；可显式声明 `packageAllowlist: []` 与 `actionAllowlist: []` 并关闭其 MCP，管理员全授权视图使用 `["*"]`。仅持有单动作授权的包在发现接口仅返回最小身份元数据，规程与 `doctor` 仅对整包授权开放，受限授权下 `package=global` 不能绕过包级授权。
    - 历史清理边界：受限授权下，`runs/clear` 需显式指定已获整包授权的包或已授权单动作；禁止无范围的清理、对单动作授权包的整包清理与全局 `runs/clean-expired`。`packageAllowlist: ["*"]` 保留全局清理能力。
    - `-H, --host <host>`：服务监听地址（默认 `127.0.0.1`）。
    - `-p, --port <port>`：服务监听端口（默认 `5177`）。
    - `-t, --token <token>`：服务访问鉴权令牌（亦可通过环境变量 `ACTIONDOCK_TOKEN` 设置）。监听非回环地址时强制要求配置。
    - `--https`：启用 HTTPS 协议。未显式指定证书时自动签发并复用本地自签名证书。
    - `--tls-cert <path>`、`--tls-key <path>`：指定生产 TLS 证书与私钥文件路径。
    - `--allow-query-token`：允许通过 URL 查询参数 `?token=...` 传递令牌（生产环境建议保持关闭）。
    - `--allow-insecure-no-auth`：允许在非回环地址下不启用令牌鉴权启动（仅限开发调试）。
    - `--no-mcp`：禁用服务内嵌的统一 `/mcp` 协议端点。
    - `-d, --dir <path>`：指定项目根目录（缺省自动查找当前工作目录所在的工程）。
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
