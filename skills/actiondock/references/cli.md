# 参考手册：CLI 命令行速查

`ad` 是 ActionDock 2.0 的统一命令行门面工具，用于驱动 Action 与 Skill 的创建、依赖管理、能力检索、本地执行、状态配置管理、测试套件调度、目录构建、打包分发与技能导出。

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
- `--envelope`：将 JSON 输出包装为标准信封结构对象（包含 `ok: true, data: T` 或 `ok: false, error: { code, message, details }`）。
- `--data-dir <path>`：指定自定义数据存储目录（覆盖默认的 `.actiondock/` 存储路径）。

---

## 全量子命令速查

### 工程脚手架与意图检索

- 项目初始化 (`ad init`)：
  ```bash
  ad init [directory] [--id <package-id>] [--name <name>] [--desc <description>]
  ```
  初始化生成包含 `actiondock.json`、`actions/`、`playbooks/` 与 `tests/` 的标准工程。

- 新建 Action 模板代码 (`ad new action`)：
  ```bash
  ad new action <id> [-d, --desc <description>] [-f, --file <filePath>]
  ```
  在当前工程中生成新 Action 模板源码并在 `actiondock.json` 中自动注册契约。

- 新建 Playbook 规程模板 (`ad new playbook`)：
  ```bash
  ad new playbook <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中生成新 Playbook 规程 Markdown 文件并在 `actiondock.json` 中自动注册。

- 能力检索与意图发现 (`ad info`)：
  ```bash
  ad info [patterns...] [-i, --intent <pattern>] [--tree] [--fallback] [--no-fallback] [-P, --package <id>] [--profile <name>] [--server <url>] [--token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  能力发现的首选入口。支持模糊意图过滤与通过 `--tree` 打印层级挂载依赖树。

- 环境诊断与体检 (`ad doctor`)：
  ```bash
  ad doctor [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  检查运行时环境、底层 SQLite 存储状态、配置就绪度及全局链接有效性。

---

### Action 开发、校验与执行

- 列出 Action 清单 (`ad list`)：
  ```bash
  ad list [patterns...] [-i, --intent <pattern>] [--fallback] [--no-fallback] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  检索并列出当前包、工作区或远端服务中已注册的 Action 清单。

- 查看 Action 详情与模式规范 (`ad describe`)：
  ```bash
  ad describe <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  调阅指定 Action 的输入输出模式规范、描述及依赖定义。

- 执行 Action (`ad run`)：
  ```bash
  ad run <id> [-P, --package <id>] [-i, --input <json>] [-f, --input-file <path>] [-c, --config <key=value...>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--timeout <duration>] [--request-id <id>] [--async] [--data-dir <path>] [--json] [--envelope]
  ```
  本地或远程执行指定 Action。复杂参数推荐使用 `--input-file <path>` 传递，后台任务可加 `--async`。

- 校验 Action 模式与契约 (`ad validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json] [--envelope]
  ```
  校验清单规范有效性、入参出参模式与引用的入口文件物理存在性。

- 自动生成 TypeScript 类型声明 (`ad generate types`)：
  ```bash
  ad generate types [--json] [--envelope]
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
  ad add <package> [--allow-install-scripts] [-D, --dev] [-P, --package <path>] [--json] [--envelope]
  ```
  安装并锁定 Action 包依赖，受原子事务保护，自动更新单一事实源锁文件 `actiondock.lock.json`。

- 移除依赖并更新锁定 (`ad remove`)：
  ```bash
  ad remove <package> [-P, --package <path>] [--json] [--envelope]
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
  将 Action 构建为 Node.js 交付目录或归档包。已废弃并移除 `--target` 与 `--bytecode` 选项。

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

- 启动 HTTP 微服务 (`ad serve`)：
  ```bash
  ad serve [-p, --port <port>] [-H, --host <host>] [-t, --token <token>] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>]
  ```
  将本地 ActionDock 项目作为轻量级微服务暴露，支持 REST 与 SSE 接口。

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
  ad profile add <name> --server <url> [--token <token>]
  ad profile use <name>
  ad profile show [name]
  ad profile rm <name>
  ad profile test [name]
  ```

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
