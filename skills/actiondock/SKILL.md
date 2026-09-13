---
name: actiondock
description: >-
  ActionDock 2.0 开发者套件与运行指南。当用户需要执行以下任务或涉及相关概念时激活此技能：
  创建、编写、修改或测试 ActionDock Action 工具（涉及 defineAction、ActionContext、受管进程与系统命令调度）；
  编写、校验或执行 Playbook 任务操作规程；
  使用或排查 ad 命令行工具（包括 ad init、ad new、ad info、ad list、ad describe、ad run、ad validate、ad generate、ad playbook、ad config、ad state、ad runs、ad serve、ad mcp、ad build、ad test、ad add、ad remove、ad pack、ad doctor、ad link、ad unlink、ad export skill、ad profile）；
  配置持久化状态与环境变量、管理全局路由注册表、执行环境体检；
  将工具构建为 Node.js 运行时交付目录、打包为 npm 压缩包或导出为 Agent Skill 资产。
  凡用户询问 ActionDock、ad 命令、@actiondock/sdk 或涉及 Agent 工具开发场景均须应用此技能。
---

# ActionDock 2.0 开发者技能指南

ActionDock 2.0 是面向 AI 智能体 Action 与 Skill 的工程化开发、测试、构建与分发工具链，命令行工具为 `ad`。
ActionDock 默认运行于 Node.js 24（要求版本大于等于 24.12.0），基于 Node 原生类型擦除与 NodeNext 模块解析。
ActionDock 采用 `actiondock.json`（规范版本号为 2）作为元数据唯一事实源，配套 `actiondock.lock.json`（规范版本号为 1）作为跨包依赖锁定事实源。
ActionDock 支持源码型与 Node.js 目录型交付形态，支持开发者使用 TypeScript 快速开发原子 Action 工具与业务 Playbook 规程，一键导出标准的 Agent Skill 资产。

---

## 智能体场景与决策路由表

当接收到具体任务时，参考下表快速索引对应的执行范式、核心命令与专项参考手册：

| 业务意图与需求 | 核心推荐命令 | 决策建议与关键原则 | 详尽参考手册 |
| :--- | :--- | :--- | :--- |
| **新建工程项目** | `ad init [directory] -i <id> -n <name>` | 生成标准工程骨架，包含清单、配置、代码与规程目录 | [developer.md](references/developer.md) |
| **新建 Action 工具** | `ad new action <id> [-d <desc>] [-f <file>]` | 脚手架自动注册清单契约，实现标准输入输出接口 | [developer.md](references/developer.md) |
| **新建 Playbook 规程** | `ad new playbook <id> [-d <desc>] [-a <actions...>]` | 脚手架生成规程 Markdown 模板并在清单中登记 | [developer.md](references/developer.md) |
| **探索可用能力** | `ad info <patterns...>` 或 `ad info -i <pattern>` | 模糊意图检索，优先检查规程与工具清单 | [cli.md](references/cli.md) |
| **列出可用 Action** | `ad list [patterns...] [-P <pkg>]` | 按包或关键词列出当前包、工作区或远端的所有 Action | [cli.md](references/cli.md) |
| **查看 Action 详情** | `ad describe <id> [-P <pkg>]` | 查看指定 Action 的 Schema 模式、入参要求与依赖 | [cli.md](references/cli.md) |
| **执行原子 Action** | `ad run <action> --input-file <path>` | 复杂对象推荐通过参数文件传递，杜绝引号转义损坏 | [cli.md](references/cli.md) |
| **执行受管系统命令** | `ctx.process.run` 与 `ctx.process.start` | 短时命令直接运行，长期交互会话通过 withControl 保证独占控制权 | [process-execution.md](references/process-execution.md) |
| **异步长任务调用** | `ad run <action> --async`，结合 `ad runs` 追踪 | 提交异步执行任务并获取凭据，追踪执行进度与结果 | [cli.md](references/cli.md) |
| **执行复合业务任务** | `ad playbook show <id>`，依步骤调度对应 Action | 规程优先原则，阅读规程正文后依步骤编排调度 | [developer.md](references/developer.md) |
| **校验清单与规程** | `ad validate` 与 `ad playbook validate` | 校验 Action 清单完整性与规程引用合法性 | [developer.md](references/developer.md) |
| **生成 TypeScript 类型** | `ad generate types` | 基于清单 Schema 自动生成强类型声明文件 | [developer.md](references/developer.md) |
| **安装与锁定依赖** | `ad add <package>` | 正式项目引入外部 Action 包，受原子事务保护 | [cli.md](references/cli.md) |
| **移除外部依赖** | `ad remove <package>` | 自动检查反向引用，安全移除依赖包 | [cli.md](references/cli.md) |
| **单元测试与验证** | `ad test [pattern]` | 内存沙箱测试，验证业务逻辑与持久化状态 | [developer.md](references/developer.md) |
| **打包 npm 分发包** | `ad pack [-P <id>] [-o <path>] [--dry-run]` | 打包为标准 npm 压缩包用于共享与发布 | [build-and-export.md](references/build-and-export.md) |
| **构建交付目录** | `ad build [-P <id>] [-o <path>] [--vendor-deps]` | 构建标准 Node.js 运行时交付目录（配合 --vendor-deps 物化依赖） | [build-and-export.md](references/build-and-export.md) |
| **导出 Agent Skill** | `ad export skill [-P <ids...>] [-m <mode>] [--bundle]` | 导出源码型、Node 目录型或复合套件技能（配合 --vendor-deps 物化依赖） | [build-and-export.md](references/build-and-export.md) |
| **重生成复合说明书** | `ad export skill --bundle [name] --skill-md-only` | 结合自定义模板与最新清单，就地仅刷新 SKILL.md | [build-and-export.md](references/build-and-export.md) |
| **安装与装载 Skill** | `npx skills add <repo>` 或放置于客户端目录 | 智能体技能获取、安装与主流客户端装载路径配置 | [consumer.md](references/consumer.md) |
| **环境与依赖按需自举** | `npm install --omit=dev && ad link .` | 首次运行报错缺依赖时，Agent 执行环境自举与本地挂载 | [consumer.md](references/consumer.md) |
| **调度已装载技能** | 意图匹配 -> 规程决议 -> 查验契约 -> 执行调用 | 引导智能体调度底层能力的标准化全生命周期流 | [consumer.md](references/consumer.md) |
| **管理运行配置项** | `ad config list`、`ad config get`、`ad config set` | 读取、设置、列出或校验项目与全局持久化配置 | [cli.md](references/cli.md) |
| **管理持久化状态** | `ad state list`、`ad state get`、`ad state set` | 跨执行生命周期读写状态键与清理命名空间 | [cli.md](references/cli.md) |
| **配置远程执行环境** | `ad profile list`、`ad profile add`、`ad profile use` | 管理远端 Runner 服务的连接凭证与当前切换目标 | [cli.md](references/cli.md) |
| **启动微服务或协议** | `ad serve` 与 `ad mcp` | 暴露轻量 HTTP 运行服务或标准 MCP 协议接口 | [cli.md](references/cli.md) |
| **本地开发软链挂载** | `ad link [path]`、`ad unlink [id|path]` | 本地源码快速试跑或多包联调，登记至本机全局路由表 | [cli.md](references/cli.md) |
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

- 智能体技能装载与按需自举：通过 `npx skills add` 安装或放置于客户端技能目录；若首次运行报错提示缺少 `ad` 或依赖，Agent 自行进入目录执行 `npm install --omit=dev` 与 `ad link .` 完成自举。
- 智能体调度引导生命周期：意图匹配激活 -> 规程优先决议（`ad playbook show`） -> 参数契约按需查验（`ad describe` 杜绝幻觉） -> 确定性调用（`ad run --input-file`） -> JSON 信封结果校验。详细调度指引参见 [consumer.md](references/consumer.md)。
- 项目工程依赖消费：在工程根目录下执行 `ad add <package>` 安装并锁定依赖，通过终端 `ad run` 调用或在源码中通过 `ctx.actions.invoke` 调度。
- 集成工具 MCP 服务挂载：在 Cursor 或 Claude Desktop 配置文件中配置命令 `"ad"`、参数 `["mcp"]`（单项目）或 `["mcp", "--all"]`（全局挂载）。

### 作业流二：作为开发者创建与扩展 Action

- 步骤一：工程初始化。执行 `ad init [directory] -i <package-id> -n <name>` 生成标准工程骨架。
- 步骤二：新建模板代码。执行 `ad new action <action-id> -d "描述"` 脚手架生成源码并在清单中注册。
- 步骤三：完善清单契约。在 `actiondock.json` 中定义 `inputSchema`、`outputSchema` 与必填属性，推荐通过 `examples` 字段补充入参与出参示例以消除模型理解歧义。
- 步骤四：生成强类型。执行 `ad generate types` 生成强类型声明文件 `.actiondock/generated/actions.d.ts`。
- 步骤五：编写业务逻辑。在 `actions/<action-id>.ts` 中使用 `defineAction` 编写纯业务逻辑，调阅 [developer.md](references/developer.md) 了解上下文 API；若涉及底层系统命令或外部进程，调阅 [process-execution.md](references/process-execution.md) 遵循受管进程规范。
- 步骤六：契约门禁校验。执行 `ad validate`，确保模式合法与引用存在。
- 步骤七：沙箱单元测试。在 `tests/<action-id>.test.ts` 中使用 `createTestRuntime` 进行纯内存测试，执行 `ad test`。
- 步骤八：编排业务规程。执行 `ad new playbook <playbook-id>` 编写标准作业规程，执行 `ad playbook validate` 校验。
- 步骤九：构建交付与导出。执行 `ad build` 构建交付目录，执行 `ad pack` 打包 npm 分发包，或执行 `ad export skill` 导出技能资产。多包复合套件可配合 `SKILL.custom.md` 或 `--skill-md-only` 使用，详见 [build-and-export.md](references/build-and-export.md)。

### 作业流三：安全执行与长任务追踪

- 传参安全规范：复杂对象推荐写入临时 JSON 文件，使用 `--input-file <path>` 传参，杜绝 Shell 引号转义损坏。
- 异步长任务管理：长耗时任务添加 `--async` 提交并获取凭据，通过 `ad runs show <runId>` 追踪事件流，通过 `ad runs cancel <runId>` 中途取消。
- 配置覆盖：调试时使用 `-c KEY=VALUE` 临时覆盖配置；生产使用 `ad config set <KEY> <VALUE>` 持久化注入。

---

## 参考文档按需调阅索引

不同业务场景下，智能体应按需查阅 `references/` 目录下的专项参考手册：

- [consumer.md](references/consumer.md)：**Agent Skill 消费与使用指南**。当智能体装载技能、运行遇阻执行按需自举、进行规程优先决议、查阅契约规范、执行调用及接入 MCP 时查阅。
- [developer.md](references/developer.md)：**Action 与规程开发指南**。当创建、编写、修改 Action 业务代码、声明元数据契约、使用运行时上下文 API（配置、状态、子进程、级联调用、日志）、编写 Playbook 规程或编写内存单元测试时查阅。
- [process-execution.md](references/process-execution.md)：**受管进程与系统命令执行指南**。当调用底层操作系统命令、管理长期交互进程与 REPL、使用 withControl 独占租约与逐流增量解码、或使用 FakeProcessDriver 编写确定性测试时查阅。
- [build-and-export.md](references/build-and-export.md)：**构建打包与 Skill 导出指南**。当执行交付产物构建、npm 打包、Agent Skill 单包或复合套件导出、配置 `SKILL.custom.md` 自定义说明书模板插槽、或执行 `--skill-md-only` 原位刷新时查阅。
- [cli.md](references/cli.md)：**命令行全量参考手册**。当需要查询特定命令的完整参数标志、退出码规范、全局选项或 JSON 输出信封格式时查阅。
- [troubleshooting.md](references/troubleshooting.md)：**故障排查与自愈决策指南**。仅在命令执行报错、发生异常或测试失败时定向查阅，依据错误代码对照表进行自愈修复。

---

## Agent 行动核心红线

- 规程优先原则：面对业务编排任务，必须优先检索并遵循现成的 Playbook，严禁无视既有规程擅自拼凑 Action 调度次序。
- 按需排查原则：严禁在每次任务执行前盲目进行前置环境检查、依赖重装或运行 `ad doctor` 体检；默认环境完备就绪，仅在实际遇到报错时按需修复。
- 元数据规范原则：在修改 Action 源码（包括参数模式、描述、依赖）或新增 Action 文件后，在 `actiondock.json` 中完整登记并执行 `ad validate` 确保清单与 Schema 严格匹配；需要类型提示时运行 `ad generate types`。
- 脚手架命令原则：新增 Action 工具可使用 `ad new action <id>` 或 `ad action create <id>`，新增 Playbook 规程可使用 `ad new playbook <id>` 或 `ad playbook create <id>`。
- 依赖管理红线：正式项目引入外部 Action 包必须在工程根目录下执行 `ad add <package>` 安装并锁定依赖，严禁使用 `ad link` 替代项目正式依赖；`ad link` 仅限本地未发布源码快速调试与工作区联调。
- 进程受管隔离原则：严禁在 Action 内部直接调用 Node.js 原生 child_process（如 exec、spawn 等），所有系统命令与外部进程必须通过 ctx.process 统一纳管；长期交互进程写操作必须通过 withControl 保证独占令牌与异常隔离。
- 确定性进程测试红线：编写涉及系统命令的单元测试时，严禁唤起操作系统真实子进程，必须使用 @actiondock/testing 提供的 FakeProcessDriver 进行确定性模拟与事件发射。
- 通道隔离原则：严禁在 Action 内部调用 `console.log`，所有日志一律使用 `ctx.log`（输出至标准错误流），确保标准输出仅输出标准 JSON 信封。
- 严格契约原则：必须为每个 Action 定义完备的 `inputSchema` 与 `outputSchema`，推荐为复杂参数补充 `examples` 示例以消除智能体理解歧义与幻觉。
- 严格调用原则：`ctx.actions.invoke` 严格仅接受动作标识符字符串或 ActionRef 引用对象，严禁传入动作定义对象或裸函数。
- 响应式取消原则：对于网络通信与耗时循环，始终绑定并检测 `ctx.signal`。
- 统一命名空间：多包交互时，Action 引用推荐采用完全限定标识符 `<package-id>/<action-id>`，避免同名短标识符歧义冲突。
- 解耦引用原则：跨工作区或跨包调用 Action 时禁止使用文件系统物理相对路径导入，必须使用逻辑标识符通过 `ctx.actions.invoke` 进行动态寻址与调用。
