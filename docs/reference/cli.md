# 参考手册：CLI 命令行速查

`ad` 是 ActionDock 2.0 的统一命令行门面工具，用于驱动 Action 与 Skill 的创建、依赖管理、能力检索、本地执行、状态配置管理、测试套件调度、目录构建、打包分发与产物导出。

---

## 统一退出码规范

ActionDock CLI 遵循确定性的退出码规范，供宿主环境、脚本与智能体精准识别执行状态：

- 退出码 0：执行成功。业务操作正常完成，或正常展示帮助与版本信息。
- 退出码 1：执行失败。包括业务逻辑执行抛错、超时中止、目标服务不可达等运行时异常。
- 退出码 2：命令行参数或选项校验失败。包括缺少必填参数、参数格式非法或存在未知选项。
- 退出码 130：进程接收外部中断信号退出。包括用户输入 Ctrl+C 触发中断或接收系统终止信号。

---

## 全局通用选项

CLI 顶层调度器对所有子命令统一注入通用控制选项：

- `-v, -V, --version`：打印 CLI 工具版本号并退出。
- `-h, --help`：打印命令帮助说明并退出。
- `--json`：以标准 JSON 格式输出结果。支持机器渲染的查询与执行命令（如 `list`、`describe`、`run`、`info`、`doctor`、`playbook show`、`validate` 等）会消费该选项；未实现机器输出的交互命令（如 `init`、`test`、`link`、`serve`、`mcp` 等）将其作为无操作选项忽略，不影响人类可读输出；发生异常时无论何种命令均统一由顶层错误处理器输出 JSON 错误信封。
- `--envelope`：将 JSON 输出包装为标准信封结构对象（包含 `ok: true, data: T` 或 `ok: false, error: { code, message, details }`）。
- `--data-dir <path>`：指定自定义数据存储目录（覆盖默认存储路径）。由涉及 SQLite 持久化与状态存储的命令消费，在纯静态解析命令中作为无操作选项忽略。

---

## 全量命令速查

### 项目初始化与体检

- 项目脚手架初始化 (`ad init`)：
  ```bash
  ad init [directory] [--id <package-id>] [--name <name>] [--desc <description>]
  ```
  初始化生成包含 `actiondock.json`、`actions/`、`playbooks/` 与 `tests/` 的标准工程。

- 生成新 Action 模板代码 (`ad new action`)：
  ```bash
  ad new action <id> [-d, --desc <description>] [-f, --file <filePath>]
  ```
  在当前工程中脚手架生成新 Action 模板源码并在 `actiondock.json` 中自动注册。

- 生成新 Playbook 规程模板 (`ad new playbook`)：
  ```bash
  ad new playbook <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中脚手架生成新 Playbook 规程 Markdown 文件并在 `actiondock.json` 中自动注册。

- 能力检索与意图发现 (`ad info`)：
  ```bash
  ad info [patterns...] [-i, --intent <pattern>] [--tree] [--fallback] [--no-fallback] [-P, --package <id>] [--profile <name>] [--server <url>] [--token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  智能体与开发者能力发现的首选入口。支持模糊匹配、正则意图过滤以及通过 `--tree` 打印层级依赖树。未找到匹配时在机器模式下返回空结果集合并保持退出码 0。

- 环境诊断与体检 (`ad doctor`)：
  ```bash
  ad doctor [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  全面检查运行时环境、依赖状态、配置就绪度及全局链接有效性。

---

### Action 开发、校验与执行

- 列出 Action 清单 (`ad list`)：
  ```bash
  ad list [patterns...] [-i, --intent <pattern>] [--fallback] [--no-fallback] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  检索并列出当前包、工作区或远程服务中可用的 Action 清单。

- 查看 Action 详情与模式规范 (`ad describe`)：
  ```bash
  ad describe <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
  ```
  查询指定 Action 的输入输出模式规范、描述及依赖定义。

- 执行 Action (`ad run`)：
  ```bash
  ad run <id> [-P, --package <id>] [-i, --input <json>] [-f, --input-file <path>] [-c, --config <key=value...>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--timeout <duration>] [--request-id <id>] [--async] [--data-dir <path>] [--json] [--envelope]
  ```
  本地或远程执行指定 Action。支持通过 `--input` 或 `--input-file` 传参，支持 `--async` 异步启动（需远程服务支持），输出标准信封结果。

- 校验 Action 模式与语法 (`ad validate`)：
  ```bash
  ad validate [id] [-P, --package <id>] [--data-dir <path>] [--json] [--envelope]
  ```
  校验指定包或动作的元数据清单规范与输入输出 Schema 定义。

- 自动生成 TypeScript 类型声明 (`ad generate types`)：
  ```bash
  ad generate types [--json] [--envelope]
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
  ad add <package> [--allow-install-scripts] [-D, --dev] [-P, --package <path>] [--json] [--envelope]
  ```
  安装并锁定 Action 包依赖，同步更新 `package.json`、`actiondock.json` 与 `actiondock.lock.json`，受原子事务快照保护。

- 移除依赖并更新锁定 (`ad remove`)：
  ```bash
  ad remove <package> [-P, --package <path>] [--json] [--envelope]
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
  将项目 Action 构建为可直接由 Node.js 运行的交付目录或压缩归档包。支持通过 `--vendor-deps` 固化生产依赖。已废弃并移除 `--target` 与 `--bytecode` 选项（传入将返回 `UNSUPPORTED_BUILD_MODE` 错误）。

- 导出智能体技能 (`ad export skill`)：
  ```bash
  ad export skill [-P, --package <id...>] [--workspace] [--all] [--bundle [name]] [-m, --mode <mode>] [-o, --out <path>] [-p, --playbook <playbooks...>] [-a, --actions <actions...>] [-z, --archive] [--skill-md <path>] [--custom-md <path>] [--skill-md-only] [--vendor-deps] [--allow-install-scripts] [--require-reproducible]
  ```
  导出面向智能体的 Agent Skill 目录。支持 `-m, --mode source`（默认源码型）与 `-m, --mode node`（自包含 Node.js 目录型）；已废弃并移除 `--standalone`、`--target` 与 `--bytecode` 选项（传入将返回 `UNSUPPORTED_BUILD_MODE` 错误）。
  复合导出（`--bundle`）支持 `--custom-md <path>` 指定自定义说明书（`SKILL.custom.md`，含槽位段落与可选 description 覆盖；缺省时自动发现工作区根目录/当前目录下的同名文件），以及 `--skill-md-only` 就地仅重生成复合 SKILL.md（始终重新生成，忽略已有 SKILL.md，不拷贝子包产物）。

---

### 规程管理

- 列出规程清单 (`ad playbook list`)：
  ```bash
  ad playbook list [patterns...] [-i, --intent <pattern>] [--no-fallback] [-P, --package <id>] [--data-dir <path>] [--json] [--envelope]
  ```

- 查看规程详细内容 (`ad playbook show`)：
  ```bash
  ad playbook show <id> [-P, --package <id>] [--data-dir <path>] [--json] [--envelope]
  ```

- 校验规程语法与引用 (`ad playbook validate`)：
  ```bash
  ad playbook validate [id] [-P, --package <id>] [--data-dir <path>] [--json] [--envelope]
  ```

- 创建新规程模板 (`ad playbook create`)：
  ```bash
  ad playbook create <id> [-d, --desc <description>] [-a, --actions <actions...>] [-f, --file <filePath>]
  ```
  在当前工程中创建新 Playbook 规程模板（功能等同于 `ad new playbook <id>`）。

---

### 配置与状态管理

- 配置管理 (`ad config`)：
  ```bash
  # 列出配置项
  ad config list [patterns...] [-g, --global] [-P, --package <id>] [-i, --intent <pattern>] [--reveal] [--data-dir <path>] [--json] [--envelope]
  # 读取配置值
  ad config get <key> [-g, --global] [-P, --package <id>] [--reveal] [--data-dir <path>] [--json] [--envelope]
  # 写入配置键值
  ad config set <key> <value> [-g, --global] [-P, --package <id>] [--data-dir <path>]
  # 删除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>] [--data-dir <path>]
  # 查看项目配置声明模式
  ad config schema [identifier] [-P, --package <id>] [--data-dir <path>] [--json] [--envelope]
  ```

- 状态持久化管理 (`ad state`)：
  ```bash
  # 列出状态键名
  ad state list [prefix] [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [-i, --intent <pattern>] [--data-dir <path>] [--json] [--envelope]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-a, --action <actionId>] [-n, --namespace <ns>] [--data-dir <path>] [--json] [--envelope]
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
  ad runs list [patterns...] [-P, --package <id>] [-i, --intent <pattern>] [-a, --action <actionId>] [-n, --limit <count>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--no-fallback] [--data-dir <path>] [--json] [--envelope]
  ```

- 查看单次执行详情 (`ad runs show`)：
  ```bash
  ad runs show <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--data-dir <path>] [--json] [--envelope]
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

- 列出所有环境配置 (`ad profile list`)：
  ```bash
  ad profile list [patterns...] [-i, --intent <pattern>] [--reveal] [--fallback] [--no-fallback] [--json] [--envelope]
  ```
  列出所有已配置的远程环境节点，支持通过 `--reveal` 明文展示敏感 Token。

- 查看环境配置详情 (`ad profile get` 或 `ad profile show`)：
  ```bash
  ad profile get <name> [--reveal] [--json] [--envelope]
  ad profile show <name> [--reveal] [--json] [--envelope]
  ```

- 添加或更新环境配置 (`ad profile add`)：
  ```bash
  ad profile add <name> --server <url> [--token <token>] [--token-env <envVar>] [-d, --desc <description>]
  ```
  注册远端环境节点，推荐使用 `--token-env` 引用环境变量以提升安全性。

- 切换当前默认环境 (`ad profile use`)：
  ```bash
  ad profile use <name>
  # 切换回本地执行模式
  ad profile use local
  ```

- 探测远端环境连通性 (`ad profile test`)：
  ```bash
  ad profile test <name> [--json] [--envelope]
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

- 启动远程调度 HTTP 微服务 (`ad serve`)：
  ```bash
  ad serve [-H, --host <host>] [-p, --port <port>] [-t, --token <token>] [--allow-query-token] [--management] [--allow-insecure-no-auth] [--cors-origin <origin>] [--max-body <size>] [--no-mcp] [-d, --dir <path>]
  ```

---

## 标准信封输出格式

使用 `--envelope` 选项或执行 Action 返回时，标准输出提供一致的信封包装：

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
