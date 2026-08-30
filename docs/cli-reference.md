# CLI 命令行参考手册 (`ac`) - ActionDock 2.0

ActionDock 命令行工具（`ac`）全量功能与参数参考。

---

## 交互设计原则

* **`stdout`**：机器可读的标准结果输出（执行 Action 时输出标准 JSON Envelope；管理类命令在传入 `--json` 时输出纯净 JSON）。
* **`stderr`**：日志输出、调试信息与诊断日志。
* **退出码 `0`**：执行成功。
* **非 0 退出码**：执行失败或参数校验未通过。

---

## 命令清单

### 项目管理（Project）

#### `ac init [directory]`
在指定目录初始化一个标准的 ActionDock 脚手架项目。
* **参数选项**：
  * `-i, --id <id>`：项目唯一标识（如 `team4u.github-tools`）
  * `-n, --name <name>`：项目展示名称（如 `GitHub Tools`）
  * `-d, --desc <desc>`：项目功能描述

#### `ac info [--json]`
展示当前项目或远程目标的元数据、已发现的 Action 清单、Playbook 清单与声明的配置项。
* **参数选项**：
  * `-p, --profile <name>`：查询指定 profile 对应的远程目标
  * `-s, --server <url>`：直接指定远程服务器地址
  * `-t, --token <token>`：远程服务器鉴权 Token
  * `--json`：以 JSON 格式输出

#### `ac link [path]`
将本地的 Action Package 注册到全局开发态注册表（`~/.actiondock/registry.json`），注册后在系统任意目录均可直接通过 `ac run <action-id>` 源码直跑。

#### `ac unlink [id|path]`
从全局开发态注册表中注销指定包。

---

### Action 管理与执行

#### `ac action create <id>`（别名：`new`）
快速脚手架生成一个标准的 Action `.ts` 文件。
* **参数选项**：
  * `-d, --desc <desc>`：Action 描述信息
  * `-f, --file <path>`：相对 `actions/` 目录的目标文件名

#### `ac action list [--json]`
列出当前项目、全局已关联包或远程 Profile 中可用的 Action 及其描述。
* **参数选项**：
  * `-p, --profile <name>`：查询指定 profile 对应的远程目标
  * `-s, --server <url>`：直接指定远程服务器地址
  * `-t, --token <token>`：远程服务器鉴权 Token
  * `--json`：以 JSON 格式输出

#### `ac action show <id>`（别名：`describe`）
查看指定 Action 的详细定义、描述、入参 JSON Schema 与出参 JSON Schema。
* **参数选项**：
  * `-p, --profile <name>`：查询指定 profile 对应的远程目标
  * `-s, --server <url>`：直接指定远程服务器地址
  * `-t, --token <token>`：远程服务器鉴权 Token
  * `--json`：以 JSON 格式输出

#### `ac action validate [id] [--json]`
校验项目中所有或指定 Action 的语法合法性与 JSON Schema 结构。

#### `ac action run <id>`（简写：`ac run <id>`）
在本地开发态或远程云节点上执行指定的 Action。
* **参数选项**：
  * `-i, --input '<json>'`：通过命令行 JSON 字符串传入入参
  * `-f, --input-file <path>`：从 JSON 文件读取入参
  * `-c, --config <KEY=val>`：临时覆盖运行时配置项（可重复指定）
  * `-p, --profile <name>`：调度至指定的云机器/环境 profile 执行
  * `-s, --server <url>`：直接调度至指定远程 HTTP Runner 执行
  * `-t, --token <token>`：远程服务器鉴权 Token
* **输出规范**：
  ```json
  {
    "ok": true,
    "runId": "01J...",
    "data": { ... }
  }
  ```

---

### 多环境与云机器调度（Profile & Serve）

#### `ac profile list [--json]`
列出所有配置的云节点/环境 profile，标记当前默认激活的目标。

#### `ac profile add <name>`
添加或更新远程云机器 Profile。
* **参数选项**：
  * `-s, --server <url>`（必填）：远程 ActionDock 服务端地址（如 `http://1.2.3.4:5177`）
  * `-t, --token <token>`：远程服务器鉴权 Token
  * `-d, --desc <description>`：机器/环境描述

#### `ac profile use <name>`
切换全局默认执行的目标 profile（切换后 `ac run` 默认发往该目标）。

#### `ac profile show [name] [--json]`
查看指定 profile 的服务器地址、鉴权状态和描述（默认查看当前激活的 profile）。

#### `ac profile test [name] [--json]`
测试与指定 profile 对应远程服务器的连通性与延迟。

#### `ac profile rm <name>`（别名：`remove`）
删除指定的 profile。

#### `ac serve`
在远端云机器上启动轻量 ActionDock HTTP Runner 监听服务。
* **参数选项**：
  * `-p, --port <port>`：监听端口（默认 `5177`）
  * `-H, --host <host>`：绑定 IP 地址（默认 `0.0.0.0`）
  * `-t, --token <token>`：用于鉴权的 Bearer Token（或设置环境变量 `ACTIONDOCK_TOKEN`）
  * `-d, --dir <path>`：项目根目录路径（默认当前工作目录）

---

### Playbook SOP 指南管理

#### `ac playbook create <id>`（别名：`new`）
快速生成一个新的 Playbook Markdown 文件模板。
* **参数选项**：
  * `-d, --desc <desc>`：Playbook 描述信息
  * `-a, --actions <actions...>`：关联的 Action ID 列表
  * `-f, --file <path>`：目标文件名

#### `ac playbook list [--json]`
列出项目中所有的 Playbook 清单。

#### `ac playbook show <id> [--json]`
查看指定 Playbook 的 Frontmatter 元数据与 SOP Markdown 内容。

#### `ac playbook validate [id] [--json]`
校验 Playbook 的 Frontmatter 语法及其引用的 Action 是否真实存在。

---

### 运行时配置管理（Config）

* `ac config list [--json]`：列出本地 SQLite 中保存的所有配置项。
* `ac config get <key> [--json]`：获取指定配置项的有效值与来源。
* `ac config set <key> <value>`：设置或更新本地配置项（支持字符串、数值或 JSON 对象）。
* `ac config delete <key>`（别名：`rm`）：删除指定的本地配置项。

---

### 共享状态管理（Shared State）

* `ac state list [prefix] [--json]`：列出当前项目本地状态数据库中的所有 Key（支持前缀过滤，自动剔除已过期 Key）。
* `ac state get <key> [--json]`：获取指定 Key 的持久化状态值（若已过期则返回 undefined 并自动清理）。
* `ac state set <key> <json-value> [--ttl <seconds>]`：写入或更新指定 Key 的状态值，支持指定生存时间（TTL，秒）。
* `ac state delete <key>`（别名：`rm`）：删除指定 Key 的状态值。

---

### 执行记录检查（Runs）

* `ac runs list [-a, --action <id>] [-n, --limit <count>] [--json]`：列出最近的 Action 执行历史（支持按 Action 过滤与分页限制）。
* `ac runs show <run-id> [--json]`：查看单次 Run 的完整执行详情、耗时、入参、出参及错误堆栈。

---

### 单元测试（Test）

#### `ac test [pattern]`
使用 Bun 内置的高性能测试运行器执行项目中的单元测试（`tests/**/*.test.ts`）。

---

### 构建与 Skill 导出（Build & Export）

#### `ac build`
将当前项目的全部 Action 编译打包为单个自包含的独立可执行文件（无外部 Node/Bun/Python 依赖）。
* **参数选项**：
  * `-t, --target <target>`：目标编译平台（如 `bun`、`linux-x64`、`darwin-arm64`、`windows-x64` 等）
  * `-o, --out <path>`：输出二进制路径
  * `-m, --minify`：是否开启代码压缩

#### `ac export skill`
一键导出完整的 Skill 交付包，包含自动生成的 `SKILL.md` 引导文档、Playbook 任务指南与独立二进制。
* **参数选项**：
  * `-t, --target <target>`：目标编译平台
  * `-o, --out <path>`：输出 Skill 目录路径
  * `-z, --archive`：自动打包为 `.zip` 压缩归档文件
