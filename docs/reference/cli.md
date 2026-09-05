# 参考手册：CLI 命令行速查

`ad` 是 ActionDock 2.0 的统一命令行门面工具，用于驱动 Action 与 Skill 的创建、能力检索、本地执行、状态配置管理、测试套件调度、独立编译与产物导出。

---

## 统一退出码规范

ActionDock CLI 遵循确定性的退出码规范，供宿主环境、脚本与智能体精准识别执行状态：

- **退出码** `0`：执行成功。业务操作正常完成，或正常展示帮助与版本信息。
- **退出码** `1`：执行失败。包括业务逻辑执行抛错、超时中止、目标服务不可达等运行时异常。
- **退出码** `2`：命令行参数或选项校验失败。包括缺少必填参数、参数格式非法或存在未知选项。
- **退出码** `130`：进程接收外部中断信号退出。包括用户输入 Ctrl+C 触发 `SIGINT` 或接收系统终止信号。

---

## 全局通用选项

绝大多数 CLI 子命令均支持以下通用控制选项：

- **选项** `--json`：以标准 JSON 格式输出结果。
- **选项** `--envelope`：将 JSON 输出包装为标准信封结构对象（包含 `ok: true, data: T` 或 `ok: false, error: { code, message, details }`）。
- **选项** `--data-dir <path>`：指定自定义数据存储目录（覆盖默认的 `.actiondock/` 存储路径）。
- **选项** `-v, --version`：打印 CLI 工具版本号并退出。
- **选项** `-h, --help`：打印命令帮助说明并退出。

---

## 全量命令速查

### 项目生命周期与环境体检

- **项目脚手架初始化**：
  ```bash
  ad init [directory] [--id <package-id>] [--name <name>] [--desc <description>]
  ```
  初始化生成包含 `actiondock.json`、`actiondock.manifest.json`、`actions/`、`playbooks/` 与 `tests/` 的标准工程。
- **元数据检查与意图发现**：
  ```bash
  ad info [patterns...] [-i, --intent <pattern>] [--tree] [--no-fallback] [-P, --package <id>] [--profile <name>] [--server <url>] [--token <token>] [--json] [--envelope]
  ```
  智能体与开发者能力发现的首选入口。支持模糊匹配、正则意图过滤以及通过 `--tree` 打印层级依赖树。
- **环境诊断与体检**：
  ```bash
  ad doctor [-P, --package <id>] [--json] [--envelope]
  ```
  全面检查运行时环境、依赖状态、配置就绪度及全局链接有效性。

### Action 开发与执行

- **脚手架创建 Action**：
  ```bash
  ad action create <id> [--desc <description>] [--file <filePath>]
  # 或使用别名
  ad action new <id> [--desc <description>] [--file <filePath>]
  ```
  在 `actions/` 创建代码模板，并自动向 `actiondock.manifest.json` 注册元数据契约。
- **列出 Action 清单**：
  ```bash
  ad action list [patterns...] [-i, --intent <pattern>] [--no-fallback] [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--json] [--envelope]
  ```
- **查看 Action 详情与模式规范**：
  ```bash
  ad action show <id> [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--json] [--envelope]
  ```
- **校验 Action 模式与语法**：
  ```bash
  ad action validate [id] [--json] [--envelope]
  ```
- **执行 Action（核心命令）**：
  ```bash
  ad action run <id> [-i, --input <json>] [-f, --input-file <path>] [-c, --config <k=v...>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--timeout <duration>] [--async] [--json] [--envelope]
  # 顶层快速别名
  ad run <id> [-i, --input <json>] [-f, --input-file <path>] [-c, --config <k=v...>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--timeout <duration>] [--async] [--json] [--envelope]
  ```
- **运行单元测试套件**：
  ```bash
  ad test [pattern]
  ```
  自动调用配置的测试运行器（默认 `node --import tsx --test tests/*.test.ts`，亦支持 `bun test`）。

### 构建与产物导出

- **编译单文件零依赖独立可执行文件**：
  ```bash
  ad build [-P, --package <id>] [-t, --target <target>] [-o, --out <path>] [-a, --actions <actions...>] [-m, --minify] [--no-minify] [--bytecode] [--no-bytecode]
  ```
  通过外部编译器将 Action 依赖闭包、运行时调度器与内嵌存储编译为单个本机可执行程序。
- **导出自包含 Agent Skill 产物**：
  ```bash
  ad export skill [-P, --package <id>] [-s, --standalone] [-t, --target <target>] [-o, --out <path>] [-p, --playbook <playbooks...>] [-a, --actions <actions...>] [-m, --minify] [--no-minify] [--bytecode] [--no-bytecode] [-z, --archive]
  ```
  默认导出源码型 Skill；传入 `-s, --standalone` 时导出内置预编译独立二进制程序的 Skill；传入 `-z, --archive` 时生成压缩归档文件。

### Playbook 规程

- **脚手架创建规程**：
  ```bash
  ad playbook create <id> [--desc <description>] [--actions <actions...>]
  ```
- **列出规程清单**：
  ```bash
  ad playbook list [patterns...] [-i, --intent <pattern>] [--no-fallback] [--json] [--envelope]
  ```
- **查看规程详细内容**：
  ```bash
  ad playbook show <id> [--json] [--envelope]
  ```
- **校验规程语法与 Action 引用**：
  ```bash
  ad playbook validate [id] [--json] [--envelope]
  ```

### 配置与状态管理

- **配置查询与管理**：
  ```bash
  # 列出配置项
  ad config list [patterns...] [-g, --global] [-P, --package <id>] [-i, --intent <pattern>] [--reveal] [--json] [--envelope]
  # 读取配置值
  ad config get <key> [-g, --global] [-P, --package <id>] [--reveal] [--json] [--envelope]
  # 写入配置键值
  ad config set <key> <value> [-g, --global] [-P, --package <id>]
  # 删除配置项
  ad config delete <key> [-g, --global] [-P, --package <id>]
  # 查看项目配置声明模式
  ad config schema [packageId] [--json] [--envelope]
  ```
- **状态持久化与生存时间管理**：
  ```bash
  # 列出状态键名
  ad state list [prefix] [-P, --package <id>] [-n, --namespace <ns>] [-i, --intent <pattern>] [-d, --detail] [--json] [--envelope]
  # 读取状态值
  ad state get <key> [-P, --package <id>] [-n, --namespace <ns>] [--json] [--envelope]
  # 写入状态键值（支持生存时间秒数）
  ad state set <key> <value> [-P, --package <id>] [-n, --namespace <ns>] [--ttl <seconds>]
  # 删除状态项
  ad state delete <key> [-P, --package <id>] [-n, --namespace <ns>] [--silent]
  # 清空状态数据
  ad state clear [prefix] [-P, --package <id>] [-n, --namespace <ns>] [-a, --all]
  ```

### 运行历史追溯

- **列出执行历史**：
  ```bash
  ad runs list [patterns...] [-P, --package <id>] [-i, --intent <pattern>] [-a, --action <actionId>] [-n, --limit <count>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--no-fallback] [--json] [--envelope]
  ```
- **查看单次执行详情**：
  ```bash
  ad runs show <id> [-P, --package <id>] [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--json] [--envelope]
  ```
- **取消正在运行的任务**：
  ```bash
  ad runs cancel <id> [-p, --profile <name>] [-s, --server <url>] [-t, --token <token>] [--reason <reason>]
  ```

### 多环境 Profile 与全局链接

- **Profile 远程配置管理**：
  ```bash
  ad profile list [--reveal] [--json] [--envelope]
  ad profile add <name> --server <url> [--token <token>] [--token-env <env>] [--desc <description>]
  ad profile show [name] [--reveal] [--json] [--envelope]
  ad profile test <name>
  ad profile use <name>
  ad profile remove <name>
  ```
- **全局工作区链接**：
  ```bash
  # 注册当前目录或指定路径至全局路由表
  ad link [path] [-r, --recursive]
  # 解除注册
  ad unlink [id|path] [-p, --prune]
  ```

### 协议集成与微服务

- **启动 MCP 服务（STDIO 管道）**：
  ```bash
  ad mcp [-d, --dir <dir>] [-P, --package <id>] [-a, --all] [--timeout <duration>]
  ```
- **启动 MCP HTTP 微服务**：
  ```bash
  ad mcp serve [-H, --host <host>] [-p, --port <port>] [-t, --token <token>] [--cors-origin <origin>]
  ```
- **启动远程调度 HTTP 微服务**：
  ```bash
  ad serve [-H, --host <host>] [-p, --port <port>] [-t, --token <token>] [--cors-origin <origin>] [--max-body <size>]
  ```

---

## 标准信封数据输出结构

当使用 `--envelope` 选项或执行 Action 返回时，标准输出提供一致的信封包装：

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
