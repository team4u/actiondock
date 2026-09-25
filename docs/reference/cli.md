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
  全面检查运行时环境、依赖状态、配置就绪度及全局链接有效性。

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
  作为编码顾问查询指定 Action 的详情，提供三层指导：
  - 输入模式字段明细：字段名、类型、是否必填与描述信息。
  - Flat 编码指引：字符串赋值格式（`path=value`）、JSON 标量与结构赋值格式（`path:=json`）与数组元素赋值格式（`path.0=...`）。
  - 建议赋值样例展示：基于 `inputSchema` 字段属性呈现无副作用的赋值示例数据，不生成动态可执行命令。

- 执行 Action (`ad run` / `ad action run`)：
  ```bash
  ad run <id> [control-options] [-- <assignments...>]
  # 或使用传统互斥选项：
  # ad run <id> [-i, --input <json> | -f, --input-file <path|->] [control-options]
  ```
  本地或远程执行指定 Action，支持 `--async` 异步启动（需远程服务支持）。
  - 协议边界：`--` 分隔符作为控制平面（ActionDock 选项如 `--json`、`--config`、`--data-dir`、`--profile`、`--timeout` 等）与数据平面（Action 入参）的协议边界。
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
  - 输出模式：**默认采用原始文本输出**。直接将结果正文（如文件 `content`、`message`、`text` 或标量字符串）原始输出到 stdout（保留真实换行与格式排版，不进行 JSON 序列化转义），附加元数据（如 `lines`、`path`、`hasMore`）通过 stderr 输出；执行失败时在 stderr 输出错误详情并以退出码 1 退出。便于命令行直观阅读、LLM Agent 精确行号消费以及管道下游工具直接处理。
  - 机器模式：添加 `--json` 选项时，面向智能体调用推荐使用；输出标准 JSON 结果信封（`{ "ok": true, "data": ... }`），业务失败时在 stdout 输出错误信封（`{ "ok": false, "error": ... }`）并以退出码 1 退出；若参数解析出错输出标准错误信封并以退出码 2 退出。
  - 传统输入选项：
    - 简单输入：使用 `-i, --input <json>` 传递内联 JSON 字符串，适合简易标量入参。
    - 文件输入：使用 `-f, --input-file <path>` 从 JSON 文件读取内容并解析，适合复杂多层嵌套对象。
    - 标准输入：使用 `-f, --input-file -` 从标准输入读取全部内容并解析，适合跨进程管道与持续集成脚本。
    - 转义安全：复杂 JSON 推荐优先使用 `--input-file` 传递，杜绝终端引号转义损坏。无论文件还是标准输入，解析前均自动剔除 UTF-8 BOM 标记，且不设人为大小上限。

- 校验 Action 模式与语法 (`ad validate` / `ad action validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  校验指定包或动作的元数据清单规范与输入输出 Schema 定义。

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
  复合导出（`--bundle`）支持 `--custom-md <path>` 指定自定义说明书（`SKILL.custom.md`，含槽位段落与可选 description 覆盖；缺省时自动发现工作区根目录/当前目录下的同名文件），以及 `--skill-md-only` 就地仅重生成复合 SKILL.md（始终重新生成，忽略已有 SKILL.md，不拷贝子包产物）。

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

- 配置管理 (`ad config`)：
  ```bash
  # 列出配置项
  ad config list [patterns...] [-g, --global] [-P, --package <id>] [-i, --intent <pattern>] [--reveal] [--data-dir <path>] [--json]
  # 读取配置值
  ad config get <key> [-g, --global] [-P, --package <id>] [--reveal] [--data-dir <path>] [--json]
  # 写入配置键值
  ad config set <key> <value> [-g, --global] [-P, --package <id>] [--data-dir <path>]
  # 删除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>] [--data-dir <path>]
  # 查看项目配置声明模式
  ad config schema [identifier] [-P, --package <id>] [--data-dir <path>] [--json]
  ```

- 状态持久化管理 (`ad state`)：
  ```bash
  # 列出状态键名
  ad state list [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [-i, --intent <pattern>] [--data-dir <path>] [--json]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>] [--json]
  # 写入状态键值（支持存活时间秒数）
  ad state set <key> <value> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--ttl <seconds>] [--data-dir <path>]
  # 删除状态项
  ad state delete <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>]
  # 清空状态数据
  ad state clear [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--all] [--data-dir <path>]
  ```

---

### 运行历史追溯

- 列出执行历史 (`ad runs list`)：
  ```bash
  ad runs list [patterns...] [-P, --package <id>] [-i, --intent <pattern>] [-a, --action <actionId>] [-n, --limit <count>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--no-fallback] [--data-dir <path>] [--json]
  ```

- 查看单次执行详情 (`ad runs show`)：
  ```bash
  ad runs show <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json]
  ```

- 取消正在运行的任务 (`ad runs cancel`)：
  ```bash
  ad runs cancel <id> [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--reason <reason>]
  ```

- 清理执行记录 (`ad runs clear`)：
  ```bash
  ad runs clear [-P, --package <id>] [--before <time>] [--all]
  ```

---

### 全局工作区链接与解除

- 注册包至全局路由表 (`ad link`)：
  ```bash
  ad link [path] [-r, --recursive]
  ```
  将本地 Action 包或工作区目录挂载至开发者注册表中，供跨目录无缝调用。

- 解除注册与修剪 (`ad unlink`)：
  ```bash
  ad unlink [identifier] [-p, --prune]
  ```
  解除指定包或工作区的挂载关系，或通过 `--prune` 自动扫描并移除失效的无效路径。

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

- 启动远程调度 HTTP/HTTPS 微服务 (`ad serve`)：
  ```bash
  ad serve [-H, --host <host>] [-p, --port <port>] [-t, --token <token>] [-P, --package <package-id>] [-A, --action <action-ref>] [--views-file <path>] [--views <json>] [--https] [--tls-cert <path>] [--tls-key <path>] [--tls-ca <path>] [--tls-passphrase <passphrase>] [--allow-query-token] [--management] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>] [--data-dir <path>]
  ```
  原生支持 HTTPS 运行。仅传入 `--https` 时自动在本地签发并复用自签名 X.509 证书；传入 `--tls-cert` 与 `--tls-key` 时加载指定的生产机构证书。
  - 参数说明：
    - `-P, --package <package-id>`：限制服务对外暴露的 Action Package 白名单，可多次指定或使用逗号分隔（例如 `-P pkg-a,pkg-b` 或 `-P pkg-a -P pkg-b`）。指定后仅允许访问白名单中的包，RESTful API 与统一内嵌 `/mcp` 端点均受此限制，请求未授权的包将返回 403 `PACKAGE_NOT_ALLOWED`。
    - `-A, --action <action-ref>`：限制服务对外暴露的动作白名单，可多次指定或使用逗号分隔（例如 `-A greet,calc` 或 `-A pkg-a/action-1`）。支持指定动作短名 `actionId` 与全限定名 `packageId/actionId`。同时指定 `-P, --package` 与 `-A, --action` 时取两者权限交集。未在白名单中的动作详情与执行均返回 403 错误（错误码 `ACTION_FORBIDDEN`）；历史运行记录列表、单次详情与取消同样受白名单限制；统一内嵌 `/mcp` 端点的工具列表与任务扩展同步过滤。
    - `--views-file <path>`：指定包含虚拟投影视图配置的 JSON 外部文件路径。支持在单个服务监听端口上划分出多个具备独立鉴权令牌、包白名单、动作白名单、管理权限门禁与专属 MCP 端点的视图。文件格式支持视图字典对象、数组形态或包裹形态。合并优先级高于 `actiondock.json` 中的 `server.views`。
    - `--views <json>`：以 JSON 字符串形式直接内联指定虚拟投影视图配置。合并优先级高于 `--views-file`。
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
