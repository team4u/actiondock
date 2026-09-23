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
  检查运行时环境、底层 SQLite 存储状态、配置就绪度及全局链接有效性。

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

- 执行 Action (`ad run` / `ad action run`)：
  ```bash
  ad run <id> [control-options] [-- <assignments...>]
  # 或使用互斥的输入选项：
  # ad run <id> [-i, --input <json> | -f, --input-file <path|->] [control-options]
  ```
  本地或远程执行指定 Action，支持 `--async` 异步启动。
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
  - 机器输出模式：面向智能体调用推荐使用 `--json`，当参数解析出错时输出标准错误信封并以退出码 2 退出；业务执行成功输出成功信封，业务执行失败以退出码 1 退出。
  - 默认原始输出：默认直接将结果正文内容（如 `content`、`text`、`message` 或文本标量）输出至 stdout，元数据输出至 stderr，保留原始格式与真实换行；业务失败时错误输出至 stderr 并以退出码 1 退出。
  - 传统输入选项：
    - 简单输入：使用 `-i, --input <json>` 传递内联 JSON 字符串。
    - 文件输入：使用 `-f, --input-file <path>` 从 JSON 文件读取内容并解析。
    - 标准输入：使用 `-f, --input-file -` 从标准输入读取全部内容并解析。
    - 转义安全：复杂对象或多行长文本推荐使用 `--input-file` 传递，避开终端引号转义问题。输入内容自动剔除 UTF-8 BOM 标记，且不设人为大小上限。

- 校验 Action 模式与契约 (`ad validate` / `ad action validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json]
  ```
  校验清单规范有效性、入参出参模式与引用的入口文件物理存在性。

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
  ad runs list [patterns...] [-a, --action <actionId>] [-n, --limit <count>] [-P, --package <id>]
  ```

- 查看执行记录详情 (`ad runs show`)：
  ```bash
  ad runs show <id>
  ```
  查看入参快照、返回值、报错堆栈、耗时与事件流。

- 取消正在运行的异步长任务 (`ad runs cancel`)：
  ```bash
  ad runs cancel <id> [-r, --reason <reason>]
  ```

- 清理历史运行记录 (`ad runs clear`)：
  ```bash
  ad runs clear [-a, --action <actionId>]
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

- 移除依赖并更新锁定 (`ad remove`)：
  ```bash
  ad remove <package> [-P, --package <path>] [--json]
  ```
  检测反向引用，安全移除 Action 包依赖，保留数据命名空间。

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

- 运行时配置管理 (`ad config`)：
  ```bash
  # 列出配置项
  ad config list [patterns...] [-g, --global] [-P, --package <id>] [-i, --intent <pattern>] [--reveal]
  # 读取配置值
  ad config get <key> [-g, --global] [-P, --package <id>] [--reveal]
  # 写入配置键值
  ad config set <key> <value> [-g, --global] [-P, --package <id>]
  # 删除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>]
  # 查看包配置模式
  ad config schema [identifier] [-P, --package <id>]
  # 输出环境导出语句
  ad config env [identifier]
  ```

- 持久化状态管理 (`ad state`)：
  ```bash
  # 列出状态项
  ad state list [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 列出状态键名
  ad state keys [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 写入状态键值（支持秒级过期 TTL）
  ad state set <key> <value> [--ttl <seconds>] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 删除状态项
  ad state delete <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>]
  # 清空状态数据
  ad state clear [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--all]
  ```

---

### 远程微服务与协议适配 (`ad serve`, `ad mcp`, `ad profile`)

- 启动 HTTP/HTTPS 微服务 (`ad serve`)：
  ```bash
  ad serve [-p, --port <port>] [-H, --host <host>] [-t, --token <token>] [--https] [--tls-cert <path>] [--tls-key <path>] [--tls-ca <path>] [--tls-passphrase <passphrase>] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>]
  ```
  将本地 ActionDock 项目作为微服务暴露，支持 REST 与 SSE 接口。原生支持 HTTPS 协议：仅传入 `--https` 时自动在本地签发并复用自签名 X.509 证书；传入 `--tls-cert` 与 `--tls-key` 时加载生产机构证书。

- 启动 Model Context Protocol 协议服务 (`ad mcp`)：
  ```bash
  # STDIO 模式启动
  ad mcp [-d, --dir <path>] [--package <package-id>] [--all] [--timeout <duration>]
  # HTTP 与 SSE 模式启动
  ad mcp serve [-p, --port <port>] [-H, --host <host>] [-t, --token <token>]
  ```

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

---

### 本地路由挂载与调试 (`ad link`, `ad unlink`)

- 注册本地包至本机路由表 (`ad link`)：
  ```bash
  ad link [path] [-r, --recursive]
  ```
  面向本地未发布源码开发联调，仅更新本地注册表（`~/.actiondock/registry.json`），不修改项目依赖。

- 解除本地包注册 (`ad unlink`)：
  ```bash
  ad unlink [id|path]
  ad unlink --prune
  ```
  `--prune` 可一键清理物理路径不存在的悬空失效软链。
