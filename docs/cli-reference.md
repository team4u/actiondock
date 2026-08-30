# CLI 命令行参考手册 - ActionDock 2.0

ActionDock 命令行工具（`actiondock`）全量功能与参数参考。

---

## 交互设计原则

* **`stdout`**：机器可读的标准结果输出（执行 Action 时输出标准 JSON Envelope；管理类命令在传入 `--json` 时输出纯净 JSON）。
* **`stderr`**：日志输出、调试信息与诊断日志。
* **退出码 `0`**：执行成功。
* **非 0 退出码**：执行失败或参数校验未通过。

---

## 命令清单

### 1. 项目管理（Project）

#### `actiondock init [directory]`
在指定目录初始化一个标准的 ActionDock 脚手架项目。
* **参数选项**：
  * `-i, --id <id>`：项目唯一标识（如 `team4u.github-tools`）
  * `-n, --name <name>`：项目展示名称（如 `GitHub Tools`）
  * `-d, --desc <desc>`：项目功能描述

#### `actiondock info [--json]`
展示当前项目的元数据、已发现的 Action 清单、Playbook 清单与声明的配置项。

---

### 2. Action 管理与执行

#### `actiondock action create <id>`（别名：`new`）
快速脚手架生成一个标准的 Action `.ts` 文件。
* **参数选项**：
  * `-d, --desc <desc>`：Action 描述信息
  * `-f, --file <path>`：相对 `actions/` 目录的目标文件名

#### `actiondock action list [--json]`
列出当前项目中扫描到的所有 Action 及其描述。

#### `actiondock action show <id>`（别名：`describe`）
查看指定 Action 的详细定义、描述、入参 JSON Schema 与出参 JSON Schema。

#### `actiondock action validate [id] [--json]`
校验项目中所有或指定 Action 的语法合法性与 JSON Schema 结构。

#### `actiondock action run <id>`（简写：`actiondock run <id>`）
在本地开发态执行指定的 Action。
* **参数选项**：
  * `-i, --input '<json>'`：通过命令行 JSON 字符串传入入参
  * `-f, --input-file <path>`：从 JSON 文件读取入参
  * `-c, --config <KEY=val>`：临时覆盖运行时配置项（可重复指定）
* **输出规范**：
  ```json
  {
    "ok": true,
    "runId": "01J...",
    "data": { ... }
  }
  ```

---

### 3. Playbook SOP 指南管理

#### `actiondock playbook create <id>`（别名：`new`）
快速生成一个新的 Playbook Markdown 文件模板。
* **参数选项**：
  * `-d, --desc <desc>`：Playbook 描述信息
  * `-a, --actions <actions...>`：关联的 Action ID 列表
  * `-f, --file <path>`：目标文件名

#### `actiondock playbook list [--json]`
列出项目中所有的 Playbook 清单。

#### `actiondock playbook show <id> [--json]`
查看指定 Playbook 的 Frontmatter 元数据与 SOP Markdown 内容。

#### `actiondock playbook validate [id] [--json]`
校验 Playbook 的 Frontmatter 语法及其引用的 Action 是否真实存在。

---

### 4. 运行时配置管理（Config）

* `actiondock config list [--json]`：列出本地 SQLite 中保存的所有配置项。
* `actiondock config get <key> [--json]`：获取指定配置项的有效值与来源。
* `actiondock config set <key> <value>`：设置或更新本地配置项（支持字符串、数值或 JSON 对象）。
* `actiondock config delete <key>`（别名：`rm`）：删除指定的本地配置项。

---

### 5. 共享状态管理（Shared State）

* `actiondock state list [prefix] [--json]`：列出当前项目本地状态数据库中的所有 Key（支持前缀过滤）。
* `actiondock state get <key> [--json]`：获取指定 Key 的持久化状态值。
* `actiondock state set <key> <json-value>`：写入或更新指定 Key 的状态值。
* `actiondock state delete <key>`（别名：`rm`）：删除指定 Key 的状态值。

---

### 6. 执行记录检查（Runs）

* `actiondock runs list [-a, --action <id>] [-n, --limit <count>] [--json]`：列出最近的 Action 执行历史（支持按 Action 过滤与分页限制）。
* `actiondock runs show <run-id> [--json]`：查看单次 Run 的完整执行详情、耗时、入参、出参及错误堆栈。

---

### 7. 单元测试（Test）

#### `actiondock test [pattern]`
使用 Bun 内置的高性能测试运行器执行项目中的单元测试（`tests/**/*.test.ts`）。

---

### 8. 构建与 Skill 导出（Build & Export）

#### `actiondock build`
将当前项目的全部 Action 编译打包为单个自包含的独立可执行文件（无外部 Node/Bun/Python 依赖）。
* **参数选项**：
  * `-t, --target <target>`：目标编译平台（如 `bun`、`linux-x64`、`darwin-arm64`、`windows-x64` 等）
  * `-o, --out <path>`：输出二进制路径
  * `-m, --minify`：是否开启代码压缩

#### `actiondock export skill`
一键导出完整的 Skill 交付包，包含自动生成的 `SKILL.md` 引导文档、Playbook 任务指南与独立二进制。
* **参数选项**：
  * `-t, --target <target>`：目标编译平台
  * `-o, --out <path>`：输出 Skill 目录路径
  * `-z, --archive`：自动打包为 `.zip` 压缩归档文件
