# Node 交付产物执行指南

获取 Node 目录型交付产物后，可以直接在目标宿主环境中执行 Action。
宿主系统无需全局安装 ActionDock CLI 工具链。

若需了解如何构建此类交付目录，请参阅 [构建打包与 Skill 导出规范](../developer/build-and-export.md)。

---

## 执行环境要求

- Node.js 运行时环境（版本大于等于 24.12.0）。
- 依托 Node.js 原生驱动能力，宿主环境无需预装全局 ActionDock 工具。

---

## 交付目录结构说明

标准的 Node 目录型交付产物包含以下核心文件与目录：

```text
delivery-package/
├── entry.mjs              # 统一的独立入口分发脚本
├── actiondock.json        # 经过依赖闭包裁剪后的项目契约清单
├── actions/               # Action 业务执行函数源码文件
├── playbooks/             # 关联的操作规程文档
└── node_modules/          # 锁定的生产依赖（构建时若指定 --vendor-deps 则内嵌物化）
```

交付目录保留 Action 业务源码与独立的运行时分发脚本。
若构建时未携带 `--vendor-deps`，首次使用时在该目录下执行 `npm install --omit=dev` 安装生产依赖。

---

## 探索与能力自省

进入交付产物目录后，可通过 `node ./entry.mjs` 调用内置分发器探索能力：

```bash
# 列出所有可用 Action 标识与简要描述
node ./entry.mjs list

# 调阅编码顾问查看输入输出模式定义、Flat 编码指引与建议赋值样例
node ./entry.mjs describe list-prs

# 查看版本号
node ./entry.mjs --version

# 查看帮助信息
node ./entry.mjs --help
```

---

## 命令行调用 Action

通过 `run` 子命令指定 Action 标识与调用参数。
独立入口原生支持 Flat JsonValue Encoding v1 编码协议：

### 扁平参数规范调用（推荐）

通过 `--` 分隔符隔离控制选项与数据入参：

```bash
# 字符串标量赋值
node ./entry.mjs run list-prs -- repo=team4u/actiondock

# 包含数值或 JSON 标量赋值（:= 严格解析为 JSON 并递归校验数值为有限数）
node ./entry.mjs run get-pr -- repo=team4u/actiondock prNumber:=101
```

- 协议边界：`--` 分隔符作为控制平面选项与数据平面入参的协议边界。
- 两种赋值操作符：
  - `path=value`：严格保留为字符串，不执行 JSON 解析与类型猜测。
  - `path:=json`：严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
- 路径语法规则：命名段表示对象属性。纯数字段表示数组索引，从 0 连续编号并拒绝稀疏数组。根节点物化为对象。系统拒绝路径冲突（`INPUT_PATH_CONFLICT`），并拦截 `__proto__` 与 `prototype` 等原型污染属性。
- 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）。未指定输入时默认为 `{}`。
- 参数校验与退出码：参数解析出错时，若指定 `--json` 则输出标准错误信封，并以退出码 2 退出。

### 传统选项传参（互斥）

```bash
# 行内 JSON 字符串传参
node ./entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'

# 指定参数文件传参
node ./entry.mjs run get-pr --input-file ./input.json
```

---

## 原始文本管道输入

目录型入口同样支持 `--stdin-field <field>`，字段名来自 Action 入参契约：

```bash
printf 'team4u/actiondock' | node ./entry.mjs run list-prs --stdin-field repo -- state=open
```

- 文本绑定规则：stdin 读取到 EOF 后作为字符串绑定，不解析 JSON、不剥 BOM、不修剪空白。空 stdin 得到空字符串，随后由 `inputSchema` 校验。
- 模式互斥：该参数可与扁平参数组合，与 `--input` 及 `--input-file`（含 `-`）互斥。已知参数错误与字段冲突在读取前拒绝。
- 大小限制：stdin 源字节与最终入参序列化大小各有默认 10MiB 上限。引号转义与补充字段均计入最终大小。读取支持取消。
- 安全边界：这是完整文本输入，不是二进制输入。管道不是事务。`pipefail` 不会阻止下游写入。高风险写入应先完整生成并校验再提交。

---

## 正文输出与机器信封

默认情况下，目录型入口直接输出标量。
对象按规则提取 `content`、字符串 `text` 或 `message`。
其余字段作为元数据写入 stderr。
未命中时输出格式化 JSON。
当前不支持 `--text-field`，也不应用默认声明。
`describe` 会如实显示这些入口差异。

需要完整结构化结果时，显式传入 `--json`：

```bash
node ./entry.mjs run list-prs --json -- repo=team4u/actiondock
```

此时 stdout 输出标准 JSON 信封：

```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat(core): support native node execution",
        "author": "octocat",
        "state": "open"
      }
    ],
    "count": 1
  }
}
```

- 若执行成功，`ok` 为 `true`，业务数据承载于 `data` 字段。
- 若执行失败，`ok` 为 `false`，错误信息承载于 `error` 字段（包含结构化错误码 `code` 与可读提示 `message`）。
- 业务日志与调试信息统一写入 stderr。需要程序化读取完整结果时使用 `--json`，不要假定默认输出必然是信封。
- 默认终端输出沿用附加换行策略，不承诺字节级透传。

---

## 配置与持久化数据管理

独立入口内置了基于 SQLite 的配置与状态存储管理。
`config set` 与 `state set` 使用与 `ad` 相同的输入规则：

- 位置值与扁平赋值：完整位置值放在 `--` 前。合法 JSON 自动解码，否则作为字符串。仅 `--` 后识别扁平赋值。`=` 为字符串，`:=` 为严格 JSON。路径校验规则复用 `run` 规则。
- 管道输入：`--stdin` 读取全部输入并裁剪末尾空白，按 JSON 或字符串解码。空输入返回错误。`--stdin-field <field>` 绑定顶层字符串字段，保留全部空白且不解析 JSON。空输入为空字符串，可与扁平赋值组合。
- 模式互斥：完整位置值、`--stdin` 与结构化模式互斥。冲突或解析错误在读取或写入前以退出码 2 拒绝。管道读取沿用 10MiB 上限并支持取消。

### 凭据与配置管理

可通过 `config` 子命令管理运行时配置项：

```bash
# 查看所有已生效的配置项字典
node ./entry.mjs config list

# 获取特定配置项的值
node ./entry.mjs config get GITHUB_TOKEN

# 写入配置的命令形态
# node ./entry.mjs config set <key> [value] [options] [-- <assignments...>]
node ./entry.mjs config set GITHUB_TOKEN ghp_xxxxxxxxx

# 从已有环境变量绑定密码字段，其他字段使用扁平赋值
printf '%s' "$MYSQL_PASSWORD" | node ./entry.mjs config set MYSQL_191 --stdin-field password -- host=localhost port:=3306 username=root

# 从受控文件读取完整值
node ./entry.mjs config set MYSQL_191 --stdin < connection.json

# 删除配置项
node ./entry.mjs config delete GITHUB_TOKEN
```

配置值组装完整后按模式校验，再整键替换。
缺少必填字段时返回错误 `CONFIG_VALUE_INVALID` 并保留旧值，不做局部更新。
`config list` 与 `config get` 返回安全脱敏视图，不提供明文查看参数。

亦可在执行命令时直接通过操作系统环境变量传入配置：

```bash
GITHUB_TOKEN=ghp_xxxxxxxxx node ./entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```

### 读写持久化状态数据

可通过 `state` 子命令管理 Action 的持久化状态：

```bash
# 列出当前包下的状态键列表
node ./entry.mjs state list

# 查看特定状态键的值
node ./entry.mjs state get <key>

# 写入状态的命令形态
# node ./entry.mjs state set <key> [value] [options] [-- <assignments...>]
node ./entry.mjs state set article -n drafts --stdin-field content -- title=草稿 tags.0=笔记 < article.md
```

状态写入采用整键替换，不合并旧对象。
`-a` Action 作用域、`-n` 命名空间、复合键与 `--ttl` 规则保持不变。
字段绑定不自动加密或脱敏。
状态读取可能显示原文，不提供配置安全视图保护。

---

## 数据存储路径与执行限制说明

- 默认数据存储路径：若未指定 `--data-dir`，系统默认使用当前操作系统用户主目录路径：
  - 数据存储位于 `~/.actiondock/data/<packageId>/runtime.db`。
  - 全局配置存储位于 `~/.actiondock/global.db`。
- 目录内局部持久化：若需将数据持久化在交付目录自身，可在调用命令时传入 `--data-dir` 参数：
  ```bash
  node ./entry.mjs --data-dir ./data run list-prs --input '{"repo": "team4u/actiondock"}'
  ```
- 单次进程同步模型：独立入口仅支持同步阻塞执行模式。若传入 `--async` 参数，系统拒绝执行并返回 `STANDALONE_ASYNC_UNSUPPORTED` 错误。若需长耗时后台异步任务，请使用 HTTP 微服务模式（`ad serve`）。
