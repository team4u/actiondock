---
name: actiondock
description: >-
  ActionDock 2.x 开发者套件与运行指南。当用户需要执行以下任务或涉及相关概念时激活此技能：
  创建、编写、修改或测试 ActionDock Action 工具（涉及 defineAction、ActionContext、受管进程与系统命令调度）；
  编写、校验或执行 Playbook 任务操作规程；
  使用或排查 ad 命令行工具（包括 ad init、ad action、ad playbook、ad info、ad list、ad describe、ad run、ad validate、ad generate、ad config、ad state、ad runs、ad serve、ad mcp、ad build、ad test、ad add、ad remove、ad pack、ad doctor、ad link、ad unlink、ad export skill、ad profile）；
  配置持久化状态与环境变量、管理全局路由注册表、执行环境体检；
  配置动作命名绑定、在 ctx.actions 调用中混合本地与远端依赖、处理同一动作多目标调用与显式降级；
  将工具构建为 Node.js 运行时交付目录、打包为 npm 压缩包或导出为 Agent Skill 资产。
  凡用户询问 ActionDock、ad 命令、@actiondock/sdk 或涉及 Agent 工具开发场景均须应用此技能。
---

# ActionDock 2.x 开发者技能指南

ActionDock 2.x 是面向 AI 智能体 Action 与 Skill 的工程化开发、测试、构建与分发工具链，命令行工具为 `ad`。
ActionDock 默认运行于 Node.js 24（要求版本大于等于 24.12.0），基于 Node 原生类型擦除与 NodeNext 模块解析。
ActionDock 采用 `actiondock.json`（规范版本号为 2）作为元数据唯一事实源，配套 `actiondock.lock.json`（规范版本号为 1）作为跨包依赖锁定事实源。
ActionDock 支持源码型与 Node.js 目录型交付形态，支持开发者使用 TypeScript 快速开发原子 Action 工具与业务 Playbook 规程，一键导出标准的 Agent Skill 资产。
Windows 下的工程包管理器命令依据 `PATH` 与 `PATHEXT` 定位：原生程序直接执行，`npm.cmd` / `npm.bat` 仅支持可定位 `npm-cli.js` 的标准安装布局，不回退到 Shell 或借用无关的 `npm_execpath`。遇到非标准包装脚本时按诊断调整工具路径；Action 业务仍使用 `ctx.process`，环境变量白名单保持不变。

---

## 智能体场景与决策路由表

当接收到具体任务时，参考下表快速索引对应的执行范式、核心命令与专项参考手册：

| 业务意图与需求 | 核心推荐命令 | 决策建议与关键原则 | 详尽参考手册 |
| :--- | :--- | :--- | :--- |
| **新建工程项目** | `ad init [directory] -i <id> -n <name>` | 生成标准工程骨架，包含清单、配置、代码与规程目录 | [developer.md](references/developer.md) |
| **新建 Action 工具** | `ad action create <id> [-i <fields...>] [-o <fields...>]` | 脚手架快速生成代码骨架与基础清单条目，复杂模式在清单中扩展 | [developer.md](references/developer.md) |
| **新建 Playbook 规程** | `ad playbook create <id> [-d <desc>] [-a <actions...>]` | 脚手架生成规程 Markdown 模板并在清单中登记 | [developer.md](references/developer.md) |
| **探索可用能力** | `ad info <patterns...>` 或 `ad info -i <pattern>` | 模糊意图检索，优先检查规程与工具清单 | [cli.md](references/cli.md) |
| **列出可用 Action** | `ad list [patterns...] [-P <pkg>]` | 按包或关键词列出当前包、工作区或远端的所有 Action | [cli.md](references/cli.md) |
| **查看 Action 详情** | `ad describe <id> [-P <pkg>]` | 作为编码顾问查看字段明细、Flat 编码指引与建议赋值样例 | [cli.md](references/cli.md) |
| **执行原子 Action** | `ad run <action> [control-options] [-- <assignments...>]` | 规范调用语法；本地执行默认对主动作及已有本地子包按实际调用准备依赖，支持 `--no-install` 显式禁用 | [cli.md](references/cli.md) |
| **混合本地与远端依赖** | `ctx.actions.invoke(ref, input, { binding })` | 由调用方 `.actiondock/bindings.json` 选择执行目标；支持同一引用多绑定，`uses` 只声明逻辑权限，不自动降级 | [action-bindings.md](references/action-bindings.md) |
| **编程式接入依赖准备** | `createActionDock({ prepareLocalPackage })` | SDK 默认不首装；显式注入准备器并统一事务恢复与首装策略 | [developer.md](references/developer.md#本地包执行前准备) |
| **执行受管系统命令** | `ctx.process.run` 与 `ctx.process.start` | 短时命令直接运行，长期交互会话通过写入与控制指令直接交互 | [process-execution.md](references/process-execution.md) |
| **异步长任务调用** | `ad run <action> --async`，结合 `ad runs` 追踪 | 提交异步执行任务并获取凭据，追踪执行进度与结果；多条后台任务可用 `ad runs watch` 阻塞等待全部终态聚合退出，后台派工无 runId 时以 `--request-id` 反查等待 | [cli.md](references/cli.md) |
| **执行复合业务任务** | `ad playbook show <id>`，依步骤调度对应 Action | 规程优先原则，阅读规程正文后依步骤编排调度 | [developer.md](references/developer.md) |
| **校验清单与规程** | `ad validate` 与 `ad playbook validate` | 校验 Action 清单完整性与规程引用合法性 | [developer.md](references/developer.md) |
| **生成 TypeScript 类型** | `ad generate types` | 基于清单 Schema 自动生成强类型声明文件 | [developer.md](references/developer.md) |
| **安装与锁定依赖** | `ad add <package>` | 正式项目引入外部 Action 包，受原子事务保护 | [cli.md](references/cli.md) |
| **移除外部依赖** | `ad remove <package>` | 自动检查反向引用，安全移除依赖包 | [cli.md](references/cli.md) |
| **单元测试与动作模拟** | `ad test [pattern]` | 内存沙箱测试，使用 MockActionInvoker 模拟多目标绑定与故障降级 | [testing.md](references/testing.md) |
| **打包 npm 分发包** | `ad pack [-P <id>] [-o <path>] [--dry-run]` | 打包为标准 npm 压缩包用于共享与发布 | [build-and-export.md](references/build-and-export.md) |
| **构建交付目录** | `ad build [-P <id>] [-o <path>] [--vendor-deps]` | 构建标准 Node.js 运行时交付目录（配合 --vendor-deps 物化依赖） | [build-and-export.md](references/build-and-export.md) |
| **导出 Agent Skill** | `ad export skill [-P <ids...>] [-m <mode>] [--bundle]` | 导出源码型、Node 目录型或复合套件技能（配合 --vendor-deps 物化依赖） | [build-and-export.md](references/build-and-export.md) |
| **重生成复合说明书** | `ad export skill --bundle [name] --skill-md-only` | 结合自定义模板与最新清单，就地仅刷新 SKILL.md | [build-and-export.md](references/build-and-export.md) |
| **安装与装载 Skill** | `npx skills add <repo>` 或放置于客户端目录 | 智能体技能获取、安装与主流客户端装载路径配置 | [consumer.md](references/consumer.md) |
| **环境与依赖按需自举** | 见排查指引 | 宿主缺少 ad 命令行或已有依赖损坏时按指引自愈 | [consumer.md](references/consumer.md) |
| **调度已装载技能** | 意图匹配 -> 规程决议 -> 查验契约 -> 执行调用 | 引导智能体调度底层能力的标准化全生命周期流 | [consumer.md](references/consumer.md) |
| **管理运行配置项** | `ad config list`、`ad config get`、`ad config set` | 读取、设置、列出或校验项目与全局持久化配置 | [cli.md](references/cli.md) |
| **管理持久化状态** | `ad state list`、`ad state get`、`ad state set` | 跨执行生命周期读写状态键与清理命名空间 | [cli.md](references/cli.md) |
| **配置远程执行环境** | `ad profile list`、`ad profile add`、`ad profile use`、`ad profile update` | 管理远端 Runner 服务的连接凭证、内网证书忽略与当前切换目标 | [cli.md](references/cli.md) |
| **启动微服务或协议** | `ad serve` 与 `ad mcp` | 暴露轻量 HTTP/HTTPS 运行服务（支持单端口多视图 Virtual Views 安全隔离、`packageAllowlist` 与 `actionAllowlist` 并集授权及 `--https` 零配置自签名）或标准 MCP 协议接口 | [cli.md](references/cli.md) |
| **本地注册与开发挂载** | `ad link [path]`、`ad unlink [id|path]` | 将本地源码目录登记至本机注册表；不注册远端 Profile，也不代替工程正式依赖 | [cli.md](references/cli.md) |
| **排查错误与自愈修复** | 遇到报错时按错误码检索决策表并自愈 | 仅在报错时查阅，严禁在执行前盲目体检 | [troubleshooting.md](references/troubleshooting.md) |

---

## 核心调度流：能力发现与规程优先决议

> [!IMPORTANT]
> **智能体关键行动准则**：
> - **按需排查原则**：默认运行环境、命令行工具与依赖均已就绪，严禁在任务启动前习惯性运行安装检查或 `ad doctor` 体检；仅在实际调用报错时按需排查。
> - **先查后用原则**：首先使用 `ad info <patterns...>` 或 `ad list [patterns...]` 搜索相关包、Action 与规程。
> - **规程优先决议**：在命中目标包后，**优先检查输出中是否存在匹配的 Playbook**。若存在规程，必须执行 `ad playbook show <id>` 读取标准操作规程，依规程步骤调用 Action；严禁擅自跳过规程自行拼凑调用顺序。仅当无匹配规程或用户明确指定单点操作时，方可直接调用单一 Action。

---

## 智能体三大核心作业流

### 作业流一：作为消费者使用 Action 与 Skill

- 智能体技能装载与执行：通过 `npx skills add` 安装或放置于客户端技能目录；本地调用 `ad run` 默认对主动作及宿主快照中已有的本地子动作在首次调用前按需准备依赖；若宿主环境缺失 `ad` 命令行工具，Agent 按需全局安装 `ad`；若调用显式使用了 `--no-install` 或环境变量禁用安装，整条调用链均禁止自动安装依赖，智能体应保持禁装策略并报告依赖未就绪，严禁擅自执行安装命令绕过策略；仅当已有依赖损坏或使用者明确要求预装时，按实际使用的包管理器执行修复命令。
- 智能体调度引导生命周期：意图匹配激活 -> 规程优先决议（`ad playbook show`） -> 参数契约按需查验（`ad describe` 编码顾问） -> 确定性调用（`ad run <action> [control-options] -- <assignments...>` 或配合 `--input` / `--input-file`） -> JSON 信封结果校验。详细调度指引参见 [consumer.md](references/consumer.md)。
- 项目依赖消费：需要本地实现的正式依赖通过 `ad add <package>` 安装并锁定；`ad link` 用于本地源码挂载与联调。纯远端依赖通过 `uses` 声明能力，并由命名绑定指向 Profile，无需安装远端源码；详见 [action-bindings.md](references/action-bindings.md)。
- 集成工具 MCP 服务挂载：在 Cursor 或 Claude Desktop 配置文件中配置命令 `"ad"`、参数 `["mcp"]`（单项目）或 `["mcp", "--all"]`（全局挂载）。

### 作业流二：作为开发者创建与扩展 Action

- 步骤一：工程初始化。执行 `ad init [directory] -i <package-id> -n <name>` 生成标准工程骨架。
- 步骤二：新建模板代码。执行 `ad action create <action-id> -d "描述" -i "name:string, count?:number" -o "message:string"` 脚手架生成初始源码并在清单中注册（命令行支持基础类型简写与可选标记）。
- 步骤三：完善清单契约。若存在字段描述、枚举、嵌套结构或复杂约束，在 `actiondock.json` 中扩展标准 JSON Schema，推荐通过 `examples` 字段补充示例以消除模型理解歧义。
- 步骤四：明确依赖与调度范围。当前宿主内的同包调用默认豁免 `uses`，显式声明时使用短标识符；跨包或跨执行目标的调用必须声明 `uses`，跨目标即使同包名也不豁免。远端依赖使用完全限定引用，在调用方 `.actiondock/bindings.json` 中绑定执行位置，不把 Profile 写进 `uses`；同一引用可有多个命名绑定。
- 步骤五：生成强类型。执行 `ad generate types` 生成强类型声明文件 `.actiondock/generated/actions.d.ts`。
- 步骤六：编写业务逻辑。在 `actions/<action-id>.ts` 中使用 `defineAction` 编写纯业务逻辑，调阅 [developer.md](references/developer.md) 了解上下文 API；若涉及底层系统命令或外部进程，调阅 [process-execution.md](references/process-execution.md) 遵循受管进程规范。
- 步骤七：契约门禁校验。执行 `ad validate`，确保模式合法与引用存在；若校验单一动作，使用短标识符。
- 步骤八：沙箱单元测试。在 `tests/<action-id>.test.ts` 中使用 `createTestRuntime` 进行纯内存测试，利用 `runtime.actions` 模拟下游动作与多目标命名绑定，执行 `ad test`，详见 [testing.md](references/testing.md)。
- 步骤九：编排业务规程。执行 `ad playbook create <playbook-id>` 编写标准作业规程，执行 `ad playbook validate` 校验。
- 步骤十：构建交付与导出。执行 `ad build` 构建交付目录，执行 `ad pack` 打包 npm 分发包，或执行 `ad export skill` 导出技能资产。多包复合套件可配合 `SKILL.custom.md` 或 `--skill-md-only` 使用，详见 [build-and-export.md](references/build-and-export.md)。

### 作业流三：安全执行与长任务追踪

- 传参安全与扁平编码规范：
  - 规范调用语法：`ad run <action> [control-options] -- <assignments...>`。
  - 协议边界：`--` 分隔符作为控制平面选项（如 `--text-field`、`--json`、`--config`、`--data-dir`、`--profile`）与数据平面（Action 入参）的协议边界。
  - 两种赋值操作符：`path=value` 严格保留为字符串，不执行 JSON 解析与类型猜测；`path:=json` 严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
  - 路径语法规则：命名段（`^[A-Za-z_][A-Za-z0-9_-]*$`）表示对象属性；纯数字段（`^(0|[1-9][0-9]*)$`）表示数组索引，数组索引必须从 0 开始连续编号，拒绝稀疏数组；根节点始终物化为对象；严禁叶节点与容器冲突、对象与数组冲突及重复赋值（违者触发 `INPUT_PATH_CONFLICT`）；拦截 `__proto__`、`constructor`、`prototype` 等原型污染敏感属性。
  - 三种输入模式严格互斥：扁平参数、`--input <json>` 与 `--input-file <path|->` 严格互斥，不可混用（违者触发 `INPUT_CONFLICT`）；未指定输入时默认传入 `{}`。
  - 原始文本管道绑定：`printf '正文' | ad run <action> --stdin-field <field> [-- <assignments...>]` 将 stdin 完整正文原样绑定为指定顶层入参字段的字符串值，适合 Markdown、CSV、补丁等原始文本；字段名来自入参契约而非返回结果；正文不解析类型、不剥 BOM、不修剪空白，空输入为空字符串；可与扁平赋值组合，与 `--input` / `--input-file` 互斥。stdin 源字节与最终入参序列化大小各有默认 10MiB 上限；管道非事务，高风险写入先完整生成并校验再执行。
  - 机器模式与退出码：仅在需要结构化提取（按错误码自愈、程序化消费完整字段）时才追加 `--json`，避免信封包装浪费上下文 token；当参数解析出错时输出标准错误信封并以退出码 2 退出。
- 纯文本输出与机器信封：
  - 默认模式：未指定 `--text-field` 且无声明式注解时，标量直接输出，结构化对象完整输出为标准 JSON 格式到 stdout，不进行私有业务字段自动嗅探。
  - 正文提取：显式指定 `--text-field <field>` 或 Action 清单声明 `annotations["actiondock.cli"] = { "textField": "<field>" }` 时，stdout 仅输出目标顶层自有字符串正文（保留真实换行且无 JSON 转义），其余字段以 JSON 对象形式输出至 stderr（元数据为空时不输出）；显式参数覆盖声明式注解。
  - 严格校验：正文字段缺失、非字符串或返回数据非对象时明确报错退出；`--text-field` 与 `--json`、`--async` 互斥并在执行前以退出码 2 退出。
  - 机器信封：如需程序化消费标准 JSON 信封，传入 `--json`，此时忽略默认正文注解。
- 异步长任务管理：长耗时任务添加 `--async` 提交并获取凭据，通过 `ad runs show <runId>` 追踪事件流，通过 `ad runs cancel <runId>` 中途取消；多条后台任务可用 `ad runs watch [ids...]` 阻塞等待全部终态后聚合退出，主控后台派工拿不到 runId 时可在派工命令携带 `--request-id`，再用同标识 `ad runs watch --request-id <id>` 反查等待。
- 配置覆盖：调试时使用 `-c KEY=value`（字符串）或 `-c KEY:=json`（严格 JSON 解析且数值为有限数，不物化路径，解析错误退出码 2）临时覆盖。
- 配置与状态写入：`ad config set <key> [value] [options] [-- <assignments...>]` 与 `ad state set <key> [value] [options] [-- <assignments...>]` 共用输入规则，独立入口也相同。完整位置值在 `--` 前，合法 JSON 自动解码（支持根数组与标量），否则为字符串；`'a=b'` 不猜为扁平赋值。仅 `--` 后识别扁平赋值，`=` 为字符串、`:=` 为严格 JSON，路径与安全检查继承 `run`。
  - `--stdin` 读取完整值并裁剪末尾 CR/LF，再按 JSON 或字符串解码，空输入报错；`--stdin-field <field>` 则把原始文本绑定到顶层字符串字段，保留 BOM、换行与全部空白，空输入为空字符串，可与扁平赋值组合。完整位置值、`--stdin`、结构化模式（扁平赋值及字段绑定）互斥，模式冲突、赋值解析与路径错误在读取 stdin 或写入前以退出码 2 拒绝。大小上限与取消语义沿用现有管道规则，详见 [cli.md](references/cli.md#运行时配置与状态持久化-ad-config-ad-state)。
  - 敏感字段引用已有环境变量，避免把真实密码直接写入命令文本：
    ```bash
    printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
    ```
  - 浏览器敏感配置录入：`ad config set <key> [-g, --global] [-P <package>] --browser` 通过本地临时页面录入凭据，不经命令参数或模型对话传递；输入渠道与保存作用域正交，保存后退出，不自动执行 Action。
    - 目标与资格校验：支持本地包（当前工程目录或显式 `-P`）及全局配置（`-g/--global`），拒绝所有有效远端目标（包含显式 `--server`、`--profile` 及默认激活 Profile 决议出的隐式远端）；包级需匹配目标包声明，全局需匹配当前宿主所有已加载包声明。至少有一项匹配项顶层标明 `secret: true`，且所有匹配项显式声明的类型均未声明或为 `string`，否则以参数错误拒绝；未声明、仅嵌套属性敏感或非字符串配置均不能通过 `--browser` 录入。全局配置写入全局存储，跨包共享但同名包级配置优先生效。
    - 模式与参数互斥：`--browser` 与位置值、`--stdin`、`--stdin-field` 以及 `--` 分隔符后的结构化输入严格互斥（包括显式空分隔符 `--`），冲突时在读取流、启动服务与写库前以退出码 2 拒绝。
    - 配置声明契约：仅支持已声明且顶层标明 `secret: true` 的字符串配置；未声明、仅嵌套字段敏感或声明非字符串类型的配置均被拒绝。无显式类型的顶层敏感配置可按字符串录入；输入不裁剪空白，不将 `123`、`false` 或 JSON 外观文本自动解码。
    - 安全与生命周期：仅监听 `127.0.0.1` 随机端口，严格校验 Host、Origin 与一次性凭据，请求体上限为 64KiB；页面不加载外部资源、不回填旧值。输入等待自创建起最多 5 分钟，校验失败不重置期限；等待时可页面取消或终端中断，一旦进入保存阶段则等待实际写入结果，不再取消或超时打断。
    - 存储与传输边界：SQLite 仍明文存储，不构成对已授权 Action 或本机程序的秘密隔离。URL 片段携带临时提交权限，请勿分享链接；无法确认自动打开浏览器成功时，标准错误流提示手动打开链接并继续等待。
  - 配置先组装完整值，再按模式校验并整键替换；缺少密码等必填字段时报 `CONFIG_VALUE_INVALID` 且原值不变，不合并旧对象。`ad config list` 与 `ad config get` 始终返回安全脱敏视图且不提供明文查看参数，拒绝 `*` 通配符实键。
  - 状态仍整键替换，保留 `-a`、`-n`、`ns:key` 与 `--ttl` 规则；字段绑定只改变输入渠道，不自动加密或脱敏状态，状态读取可能显示原文，不要将其视为配置安全视图。

---

## 配置声明与安全边界

- 动态配置可使用 `MYSQL_*` 这类单星号模板；具体键优先于模板，模板不允许 `required`、`default` 或 `env`。对象中的密码可通过受限 `schema` 的字段级 `secret: true` 隐藏，详见 [developer.md](references/developer.md)。
- 配置管理只提供安全视图，Action 的 `ctx.config.get` 仍返回完整原值；不要将原值写入日志、状态或返回结果。脱敏输出不能直接回写，否则掩码会被当成普通字符串保存。配置视图的 `source` 与核心 `ConfigSource` 契约一致，仅取 `override`、`package`、`global`、`env`、`default` 或 `null`，未命中为 `null` 而非 `default`；`ad config schema` 中模板项与缺失项 `source` 同样为 `null`，语义由 `status` 表达。
- 回退旧版本前，必须给已存动态配置补上具体键的顶层 `secret: true` 声明，避免旧版本不认识模板而显示原文。远端查询要求服务端提供 `configViewVersion: 1` 完整视图，旧服务端响应被直接拒绝（`PROTOCOL_UNSUPPORTED`）；服务端回退至不支持该协议的版本后，新客户端配置查询将被拒绝，必须保留协议能力或配套调整客户端版本，远端契约与全局配置规则见 [cli.md](references/cli.md)。
- 远端服务授权边界：`ad serve` 的包与动作授权统一由 `packageAllowlist` 与 `actionAllowlist` 两份白名单的并集决定。`packageAllowlist` 授予整包能力，覆盖该包当前与未来新增的全部动作；`actionAllowlist` 仅接受 `packageId/actionId` 全限定精确引用，拒绝短名与通配符；某一白名单省略或为空数组只表示不增加该项授权，两份白名单均无授权时不暴露包与动作，执行请求被拒绝。`packageAllowlist: ["*"]` 是唯一的显式全量访问标记（不支持其他通配模式），且不自动开启 `enableManagement`。CLI 的 `-P/-A` 参数与视图配置遵循同一并集语义，`ad serve -P '*'` 即显式全开放。例如在 `server.views.agent` 中设置 `"packageAllowlist": ["pkg-a"]`、`"actionAllowlist": ["pkg-b/read"]`，表示 pkg-a 整包可用（含未来新增动作）且 pkg-b 仅 `read` 单动作可见可用；只想开放 pkg-a/read 时只写 `actionAllowlist: ["pkg-a/read"]`，不再授权整包。默认视图未授予权限时不暴露包与动作，部署时可用 `packageAllowlist: []` 与 `actionAllowlist: []` 显式声明并关闭其 MCP；命名视图独立配置，不继承默认视图的 Token 与白名单。受限授权不能发起无范围或越权的历史清理，也不能通过 `package=global` 绕过包级授权。安全边界详见 [cli.md](references/cli.md)。

## 参考文档按需调阅索引

不同业务场景下，智能体应按需查阅 `references/` 目录下的专项参考手册：

- [consumer.md](references/consumer.md)：**Agent Skill 消费与使用指南**。当智能体装载技能、运行遇阻执行按需自举、进行规程优先决议、查阅契约规范、执行调用及接入 MCP 时查阅。
- [developer.md](references/developer.md)：**Action 与规程开发指南**。当创建、编写、修改 Action 业务代码、声明元数据契约、使用运行时上下文 API（配置、状态、子进程、级联调用、日志）、编写 Playbook 规程或编写内存单元测试时查阅。
- [testing.md](references/testing.md)：**Action 单元测试与动作模拟**。当需要模拟 `ctx.actions.invoke`、按绑定区分下游响应、注入故障或一次性序列、断言调用历史与取消行为时查阅；不要用真实 Profile 替代单元测试模拟。
- [action-bindings.md](references/action-bindings.md)：**动作命名绑定与远端调用**。当 Action 内混合调用本地与远端依赖、同一动作需要多个执行目标、配置 `.actiondock/bindings.json`、实现显式降级或排查远端结果未知时查阅。
- [process-execution.md](references/process-execution.md)：**受管进程与系统命令执行指南**。当调用底层操作系统命令、管理长期交互进程与 REPL、使用逐流增量解码、或使用 FakeProcessDriver 编写确定性测试时查阅。
- [build-and-export.md](references/build-and-export.md)：**构建打包与 Skill 导出指南**。当执行交付产物构建、npm 打包、Agent Skill 单包或复合套件导出、配置 `SKILL.custom.md` 自定义说明书模板插槽、或执行 `--skill-md-only` 原位刷新时查阅。
- [cli.md](references/cli.md)：**命令行全量参考手册**。当需要查询特定命令的完整参数标志、退出码规范、全局选项或 JSON 输出信封格式时查阅。
- [troubleshooting.md](references/troubleshooting.md)：**故障排查与自愈决策指南**。仅在命令执行报错、发生异常或测试失败时定向查阅，依据错误代码对照表进行自愈修复。

---

## Agent 行动核心红线

- 规程优先原则：面对业务编排任务，必须优先检索并遵循现成的 Playbook，严禁无视既有规程擅自拼凑 Action 调度次序。
- 按需排查原则：严禁在每次任务执行前盲目进行前置环境检查、依赖重装或运行 `ad doctor` 体检；默认环境完备就绪，仅在实际遇到报错时按需修复。
- 元数据规范原则：在修改 Action 源码（包括参数模式、描述、依赖）或新增 Action 文件后，在 `actiondock.json` 中完整登记并执行 `ad validate` 确保清单与 Schema 严格匹配；需要类型提示时运行 `ad generate types`。
- 脚手架命令原则：新增 Action 工具使用 `ad action create <id>`，命令行 `--input` 与 `--output` 仅用于生成基础字段骨架；若包含枚举、嵌套属性、正则或字段描述等复杂语义，必须在 `actiondock.json` 中以标准 JSON Schema 声明，并执行 `ad generate types` 同步类型。新增 Playbook 规程使用 `ad playbook create <id>`。
- 依赖与权限边界：正式本地依赖使用 `ad add`，`ad link` 仅处理本机源码挂载。`uses` 仅授权，不作为安装清单；本地 `ad run` 按实际调用准备已有目标，远端子调用不触发本机同名包准备。禁装策略贯穿调用链，准备失败不重跑父动作或撤销既有副作用；已有 `node_modules` 缺包时只报错，不自动重建。建图前引导、工作区安装范围与 SDK 显式接入见 [developer.md](references/developer.md#本地包执行前准备)。
- 进程受管隔离原则：严禁在 Action 内部直接调用 Node.js 原生 child_process（如 exec、spawn 等），所有系统命令与外部进程必须通过 ctx.process 统一纳管。
- 确定性动作测试红线：使用 `runtime.actions.register` 或 `registerOnce` 按引用与绑定精确模拟下游；保留真实 Runner、`uses` 授权与契约校验，不手工替换 `ctx`。未命中的具名模拟直接失败，不能访问真实远端；网络协议能力另用回环服务集成测试验证。
- 确定性进程测试红线：编写涉及系统命令的单元测试时，严禁唤起操作系统真实子进程，必须使用 @actiondock/testing 提供的 FakeProcessDriver 进行确定性模拟与事件发射。
- 通道隔离原则：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至标准错误流），确保标准输出仅输出标准 JSON 信封。
- 严格契约原则：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`，推荐为复杂参数补充 `examples` 示例以消除智能体理解歧义与幻觉。
- 严格调用原则：`ctx.actions.invoke` 首参数仅接受动作标识符字符串或 ActionRef 引用对象，严禁传入动作定义对象或裸函数；第三参数仅接受可选的 `binding`，不得写入 Profile、URL 或凭证。
- 目标选择边界：CLI 的 `--profile` 选择整条命令的宿主，内部依赖由该宿主的命名绑定选择；没有 `--binding` CLI 参数。未指定绑定只查 `default`，没有则保持本地；显式绑定不存在直接报错，禁止猜测目标。
- 降级安全边界：框架不自动重试或回退。父任务取消后停止调用；网络断链与 `SERVICE_RESULT_UNKNOWN` 不代表远端未执行，不能盲目重跑有副作用的 Action。
- 交付隔离边界：`.actiondock/bindings.json` 与 Profile 凭据不进入构建或导出产物，目标宿主需独立配置；远端运行记录必须在对应 Profile 查询。
- 响应式取消原则：对于网络通信与耗时循环，始终绑定并检测 `ctx.signal`。
- 统一命名空间：多包交互时，Action 引用推荐采用完全限定标识符 `<package-id>/<action-id>`，避免同名短标识符歧义冲突。
- 解耦引用原则：跨工作区或跨包调用 Action 时禁止使用文件系统物理相对路径导入，必须使用逻辑标识符通过 `ctx.actions.invoke` 进行动态寻址与调用。
