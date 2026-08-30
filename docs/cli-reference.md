# CLI 命令行参考手册 (`ac`)

ActionDock 命令行工具（简写为 `ac`）提供了全生命周期的项目脚手架、Action 调试、MCP 协议服务、多云环境调度、本地存储治理、独立编译与 Skill 导出能力。

---

# 交互设计与协议底线

- **标准输出** （`stdout`）：机器可读的纯净数据通道。执行 Action 时输出标准 JSON Envelope；管理类命令在传入 `--json` 时输出纯净 JSON。
- **标准错误** （`stderr`）：结构化运行日志、调试诊断信息与进度消息。
- **退出码规范**：执行成功返回 `0`；发生业务异常、参数校验失败或内部错误时返回非 0（通常为 `1`）。

---

# 命令总览速查表

| 分类 | 命令 | 说明 |
| :--- | :--- | :--- |
| **项目管理** | `ac init [dir]` | 初始化 ActionDock 脚手架项目 |
| | `ac info [--json]` | 查看当前项目或远程主机的元数据与清单元信息 |
| | `ac link [path]` | 注册本地包到全局注册表（实现跨目录源码直跑） |
| | `ac unlink [id\|path]` | 从全局注册表中移除指定包 |
| **Action 管理** | `ac action create <id>` | 快速生成新的 Action TypeScript 文件模板 |
| | `ac action list [patterns...]` | 检索可用 Action 清单（支持正则意图 `-i` 与多关键字） |
| | `ac action show <id>` | 查看指定 Action 的详细定义与 Schema 结构 |
| | `ac action validate [id]` | 校验 Action 语法合法性与 JSON Schema 结构 |
| | `ac action run <id>` (`ac run`) | 本地或远程执行 Action 并输出标准 JSON Envelope |
| **MCP 协议** | `ac mcp` | 启动 MCP STDIO 服务端（支持多目录/多包聚合与 Tasks 扩展） |
| | `ac mcp serve` | 启动 MCP Streamable HTTP 协议微服务 |
| **多环境调度** | `ac profile list` | 查看与管理多云主机 Profile（支持 Token 脱敏） |
| | `ac profile add <name>` | 添加远程云机器 Profile（推荐使用 `--token-env`） |
| | `ac profile use <name>` | 切换默认激活的目标云主机 Profile |
| | `ac profile show [name]` | 查看指定 Profile 详细信息与明文 Token（`--reveal`） |
| | `ac profile test [name]` | 测试远程节点的网络连通性与健康状态 |
| | `ac profile rm <name>` | 删除指定的 Profile |
| | `ac serve` | 在远程主机启动轻量 HTTP Runner 监听服务 |
| **Playbook 规程** | `ac playbook create <id>` | 快速生成新的 Playbook SOP Markdown 模板 |
| | `ac playbook list` | 列出项目中的所有 Playbook 清单 |
| | `ac playbook show <id>` | 查看指定 Playbook 的 Markdown 内容与依赖元数据 |
| | `ac playbook validate` | 校验 Playbook 的 Frontmatter 语法与 Action 依赖闭包 |
| **配置管理** | `ac config schema [id]` | 检查 Action 声明的配置依赖与解析状态 |
| | `ac config list` | 查看本地/全局有效配置清单（支持脱敏与正则过滤） |
| | `ac config get <key>` | 获取指定配置项的最终有效值与解析来源 |
| | `ac config set <key> <val>` | 写入或更新持久化配置（支持 `-g` 全局模式） |
| | `ac config delete <key>` | 删除指定的配置项 |
| **状态管理** | `ac state list` | 查看持久化状态 Key 列表（自动清理过期 Key） |
| | `ac state get <key>` | 获取指定 Key 的持久化状态数据 |
| | `ac state set <key> <val>` | 写入或更新状态（支持 `--ttl` 过期时间） |
| | `ac state delete <key>` | 删除指定的状态记录 |
| **执行历史** | `ac runs list` | 查看最近的 Action 执行历史与父子链路 |
| | `ac runs show <id>` | 查看单次 Run 的完整执行详情、耗时与堆栈（支持 `--profile`） |
| | `ac runs cancel <id>` | 取消正在远端执行中的 Action 任务 |
| **测试与验证** | `ac test [pattern]` | 使用 Bun 原生测试运行器执行单元测试 |
| **构建与分发** | `ac build` | 将项目编译为单文件自包含独立二进制 |
| | `ac export skill` | 导出包含 `SKILL.md` + 独立二进制的 Agent Skill 交付包 |

---

# 子命令详细手册

## 项目管理 (Project)

### `ac init [directory]`
在指定目录初始化一个标准的 ActionDock 脚手架项目。
- `-i, --id <id>`：项目唯一标识（如 `team4u.github-tools`）。
- `-n, --name <name>`：项目展示名称（如 `GitHub Tools`）。
- `-d, --desc <desc>`：项目功能描述。

### `ac info [--json]`
展示当前项目或远程目标的元数据、Action 清单、Playbook 清单与声明的配置项。
- `-p, --profile <name>`：查询指定 profile 对应的远程主机。
- `-s, --server <url>`：直接指定远程服务器地址。
- `-t, --token <token>`：远程服务器 Bearer Token。
- `--json`：以标准 JSON 格式输出。

### `ac link [path]`
将本地的 Action Package 注册到全局开发态注册表（`~/.actiondock/registry.json`）。注册后在系统任意目录均可源码直跑。

### `ac unlink [id|path]`
从全局开发态注册表中注销指定包。

---

## Action 管理与执行

### `ac action create <id>`（别名：`new`）
快速脚手架生成一个标准的 Action `.ts` 文件。
- `-d, --desc <desc>`：Action 描述信息。
- `-f, --file <path>`：相对 `actions/` 目录的目标文件名。

### `ac action list [patterns...] [--json]`
列出可调用的 Action 及其描述。
- `[patterns...]`：位置参数关键字或模式（支持多个，如 `ac action list pr issue`）。
- `-i, --intent <pattern>`：正则表达式意图过滤（如 `-i "pr|issue"`）；未命中时默认回退全量列表。
- `--no-fallback`：禁用未命中时的全量回退，严格返回空匹配。
- `-p, --profile <name>`：查询指定 profile 对应的远程目标。
- `-s, --server <url>`：直接指定远程服务器地址。
- `-t, --token <token>`：远程服务器鉴权 Token。
- `--json`：以 JSON 格式输出。

### `ac action show <id>`（别名：`describe`）
查看指定 Action 的详细定义、描述、入参 JSON Schema 与出参 JSON Schema。

### `ac action validate [id] [--json]`
校验项目中所有或指定 Action 的语法合法性与 JSON Schema 结构。

### `ac action run <id>`（简写：`ac run <id>`）
在本地开发态或远程云节点上执行指定的 Action。
- `-i, --input '<json>'`：通过命令行 JSON 字符串传入入参。
- `-f, --input-file <path>`：从 JSON 文件读取入参。
- `-c, --config <KEY=val>`：临时覆盖运行时配置项（可重复指定）。
- `--timeout <duration>`：设置超时时间（如 `500ms`、`30s`、`5m`、`1h`），超时将触发 `ACTION_TIMEOUT` 终止。
- `--async`：异步执行任务（仅在配合 `--profile` 或 `--server` 时支持，返回 202 异步 Run 记录）。
- `-p, --profile <name>`：调度至指定的云机器/环境 profile 执行。
- `-s, --server <url>`：直接调度至指定远程 HTTP Runner 执行。
- `-t, --token <token>`：远程服务器鉴权 Token。

---

## Model Context Protocol (MCP)

### `ac mcp`
以 STDIO 模式启动 MCP 服务端，将当前或指定 package 内的 Actions 作为 MCP Tools 提供给本地 MCP Client（Claude Code、Cursor 等）。
- `-d, --dir <path...>`：指定 ActionDock 项目根目录（支持多次指定或逗号分隔指定多目录）。
- `--package <package-id...>`：指定全局已链接的 package ID（支持多次指定或逗号分隔）。
- `--all`：聚合暴露全局注册表中所有已链接的 Packages。
- `--timeout <duration>`：单次 Action 执行的超时时间（如 `30s`）。

### `ac mcp serve`
以 HTTP 模式启动 MCP 服务端，提供标准 Streamable HTTP `/mcp` 端点与 `/health` 健康检查端点，支持 MCP Tasks 协议端点（`tasks/get`、`tasks/cancel`、`tasks/list`）。
- `-p, --port <port>`：监听端口（默认 `5178`）。
- `-H, --host <host>`：绑定 IP 地址（默认安全监听 `127.0.0.1`）。
- `-t, --token <token>`：Bearer 鉴权 Token。
- `--token-env <env>`：**推荐**：指定包含 Token 的环境变量名。
- `--allow-insecure-no-auth`：允许在非 Loopback 地址上无 Token 运行（不安全）。
- `--cors-origin <origin>`：允许跨域调用的 CORS Origin 白名单（支持多次指定）。
- `--max-body <size>`：请求 Body 最大字节限制（默认 `1mb`）。
- `-d, --dir <path...>`：项目根目录路径（支持多目录聚合）。
- `--package <package-id...>`：指定已链接的 package ID（支持多包聚合）。
- `--all`：聚合暴露全局 Registry 中所有已链接包。
- `--timeout <duration>`：单次 Action 执行的超时时间。

---

## 多环境与云机器调度 (Profile & Serve)

### `ac profile list [patterns...] [--reveal] [--json]`
列出所有配置的云节点/环境 profile，标记当前默认激活的目标与 Token 来源（支持 `-i, --intent <pattern>` 正则与位置关键字模糊过滤，支持敏感 Token 脱敏与 `--reveal` 明文展示）。

### `ac profile add <name>`
添加或更新远程云机器 Profile。
- `-s, --server <url>`（必填）：远程 ActionDock 服务端地址（如 `http://1.2.3.4:5177`）。
- `--token-env <env>`（ **推荐** ）：指定存储鉴权 Token 的环境变量名（如 `ACTIONDOCK_PROD_TOKEN`）。
- `-t, --token <token>`：明文存储 Token（不推荐持久化明文）。
- `-d, --desc <description>`：机器/环境描述。

### `ac profile use <name>`
切换全局默认执行的目标 profile（切换后 `ac run` 默认发往该目标）。

### `ac profile show [name] [--reveal] [--json]`
查看指定 profile 的服务器地址、鉴权状态、解析来源和描述（默认查看当前激活的 profile）。

### `ac profile test [name] [--json]`
测试与指定 profile 对应远程服务器的连通性与网络延迟。

### `ac profile rm <name>`（别名：`remove`）
删除指定的 profile。

### `ac serve`
在远端云机器上启动轻量 ActionDock HTTP Runner 监听服务。
- `-p, --port <port>`：监听端口（默认 `5177`）。
- `-H, --host <host>`：绑定 IP 地址（默认安全监听 `127.0.0.1`）。
- `-t, --token <token>`：用于鉴权的 Bearer Token。
- `--token-env <env>`：指定包含 Token 的环境变量名。
- `--allow-insecure-no-auth`：允许在非 Loopback 地址上无 Token 运行（不安全）。
- `--cors-origin <origin>`：允许跨域调用的 CORS Origin 白名单。
- `--max-body <size>`：请求 Body 最大字节限制（默认 `1mb`）。
- `--expose-debug-info`：在 health 和 info 接口中返回宿主机绝对路径。
- `-d, --dir <path>`：项目根目录路径（默认当前工作目录）。

---

## Playbook SOP 指南管理

### `ac playbook create <id>`（别名：`new`）
快速生成一个新的 Playbook Markdown 文件模板。
- `-d, --desc <desc>`：Playbook 描述信息。
- `-a, --actions <actions...>`：关联的 Action ID 列表。
- `-f, --file <path>`：目标文件名。

### `ac playbook list [patterns...] [--json]`
列出项目中所有的 Playbook 清单（支持 `-i, --intent <pattern>` 正则与关键字搜索）。

### `ac playbook show <id> [--json]`
查看指定 Playbook 的 Frontmatter 元数据与 SOP Markdown 内容。

### `ac playbook validate [id] [--json]`
校验 Playbook 的 Frontmatter 语法及其引用的 Action 是否真实存在。

---

## 运行时配置管理 (Config)

- `ac config schema [id] [--json]`（别名：`ac config check`）：检查当前项目或指定 Action 声明的配置依赖，展示生效状态（`[SET]` / `[DEFAULT]` / `[MISSING]`）与来源。
- `ac config list [patterns...] [-P <pkg>] [-g] [--reveal] [--json]`：列出有效配置清单（支持敏感信息脱敏与 `--reveal` 明文展示）。
- `ac config get <key> [-P <pkg>] [-g] [--reveal] [--json]`：获取指定配置项的最终有效值与解析来源。
- `ac config set <key> <value> [-g]`：设置或更新配置项（不在项目目录时默认写入全局 `~/.actiondock/global.db`）。
- `ac config delete <key> [-g]`（别名：`rm`）：删除指定的本地或全局配置项。

---

## 共享状态管理 (Shared State)

- `ac state list [prefix] [-i, --intent <pattern>] [--json]`：列出当前项目本地状态数据库中的 Key（自动剔除已过期 Key）。
- `ac state get <key> [--json]`：获取指定 Key 的持久化状态值。
- `ac state set <key> <json-value> [--ttl <seconds>]`：写入或更新指定 Key 的状态值，支持指定生存时间（TTL，秒）。
- `ac state delete <key>`（别名：`rm`）：删除指定 Key 的状态值。

---

## 执行记录检查 (Runs)

- `ac runs list [patterns...] [-i, --intent <pattern>] [-a, --action <id>] [-n, --limit <count>] [--json]`：列出最近的 Action 执行历史。
- `ac runs show <run-id> [-p <profile>] [-s <server>] [-t <token>] [--json]`：查看单次 Run 的完整执行详情、耗时、入参、出参及错误堆栈（支持本地或通过 `--profile` 查询远程记录）。
- `ac runs cancel <run-id> -p <profile>|-s <server> [-r, --reason <reason>] [--json]`：取消正在远端服务器上执行中的 Action 任务。

---

## 单元测试 (Test)

### `ac test [pattern]`
使用 Bun 内置的高性能测试运行器执行项目中的单元测试（`tests/**/*.test.ts`）。

---

## 构建与 Skill 导出 (Build & Export)

### `ac build`
将当前项目的 Action 编译打包为单个自包含的独立可执行文件。
- `-t, --target <target>`：目标编译平台（如 `host`、`linux-x64`、`darwin-arm64`、`windows-x64`）。
- `-o, --out <path>`：输出二进制路径。
- `-a, --actions <actions...>`：仅编译指定的 Action(s)。
- `-m, --minify` / `--no-minify`：代码压缩（默认开启）。
- `--bytecode` / `--no-bytecode`：编译为字节码以加速启动（默认开启）。

### `ac export skill`
导出面向 AI Agent 的 Skill 交付包（默认导出轻量级源码型 Skill；使用 `-s, --standalone` 导出包含预构建独立二进制的便携 Skill）。
- `-s, --standalone`：导出预编译独立二进制 Skill（适用于目标机器未安装 ActionDock 的裸机环境）。
- `-t, --target <target>`：独立编译模式下的目标平台（如 `host`、`linux-x64`、`darwin-arm64`、`windows-x64`）。
- `-o, --out <path>`：输出 Skill 目录路径。
- `-p, --playbook <playbooks...>`：任务驱动导出：仅打包指定 Playbook 及其依赖的 Actions（自动 Tree-shaking 裁剪）。
- `-a, --actions <actions...>`：仅导出指定的 Action(s)，并自动裁剪依赖未包含 Action 的 Playbooks。
- `-m, --minify` / `--no-minify`：在 standalone 模式下开启/关闭代码压缩（默认开启）。
- `--bytecode` / `--no-bytecode`：在 standalone 模式下开启/关闭字节码编译（默认开启）。
- `-z, --archive`：自动打包为 `.zip` 压缩归档文件。

---

# 标准 JSON Envelope 契约输出

### 成功执行响应 (`result.ok: true`)
```json
{
  "ok": true,
  "runId": "01JXYZ...",
  "data": {
    "key": "value"
  }
}
```

### 错误响应 (`result.ok: false`)
```json
{
  "ok": false,
  "runId": "01JXYZ...",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Input validation failed: 'username' is a required property",
    "details": [ ... ]
  }
}
```

---

# 文档导航

- [错误代码与排错手册](error-codes.md)：查看所有标准错误代码定义与排错建议。
- [快速上手指南](quick-start.md)：快速体验核心 CLI 工作流。
- [构建编译与 Skill 分发](build-and-export.md)：深入学习独立构建与交叉编译。
