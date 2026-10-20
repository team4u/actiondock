# 参考手册：配置解析机制 (Config)

ActionDock 提供了强类型、多层级回退的配置管理机制，使得 Action 在本地调试、自动化测试与多环境部署中保持灵活性与安全性。

---

## 配置解析优先级

当 Action 内调用 `ctx.config.get("API_KEY")` 时，执行引擎按如下严格顺序逐级寻找配置，一旦命中即刻返回：

```text
单次调用参数覆盖
        CLI: --config KEY=xxx
        HTTP: body.config = { KEY: "xxx" }
        ↓
包级 SQLite 持久化配置数据库
        通过 ad config set API_KEY xxx 写入（当前包独享）
        ↓
全局级 SQLite 持久化配置数据库
        通过 ad config set -g API_KEY xxx 写入（跨所有 Action Package 共享）
        ↓
操作系统环境变量 (process.env)
        按候选键名优先级逐级匹配
        ↓
项目清单默认配置声明
        actiondock.json -> config.<KEY>.default
        ↓
代码内联默认回退值
        ctx.config.get("API_KEY", "fallback-val")
```

---

## CLI 配置作用域与操作规则

- 包内执行（默认）：若当前目录或父级存在 `actiondock.json`，`ad config set <KEY> <VALUE>` 写入当前包独立的持久化存储空间。
- 全局配置（-g / --global）：使用 `ad config set -g <KEY> <VALUE>` 写入全局存储空间，跨所有包共享。
- 项目外执行：在任意非 Action Package 目录下执行 `ad config set`，将自动写入全局存储。
- 查看配置：`ad config list`（展示当前包合并视图，敏感配置安全脱敏），`ad config list -g`（仅查看全局配置）。为保障凭据安全，系统不提供明文回显接口，也不提供明文查看参数。
- 敏感对象标准输入注入：针对复杂或包含敏感字段的对象，推荐使用管道从标准输入写入，避免密钥明文留存于操作系统命令历史中：
  ```bash
  printf '%s' '{"host":"127.0.0.1","username":"root","password":"secret"}' | ad config set MYSQL_191 -P pkg --stdin
  ```
- 拒绝通配实键：`ad config get`、`ad config set` 与 `ad config delete` 严格拒绝包含通配符 `*` 的实键操作，避免误伤或破坏模板定义。
- 写入原子性与写前校验：所有配置写入均执行整键全量替换，写入前依据模式严格校验。校验失败时抛出 `CONFIG_VALUE_INVALID` 错误（错误明细严禁携带输入中的实际值），原有存储值保持不变。脱敏输出不能直接作为更新载荷回写：系统不会把 `********` 解释为保留旧密码，写入时它就是普通字符串。不支持字段级部分更新与对象合并。

---

## 环境变量命名与类型强转

运行时从 `process.env` 解析配置值，不自动加载隐式 `.env` 文件。

### 环境变量候选键匹配规则

若当前包 ID 为 `team4u.github-tools`，查询键名 `apiKey` 时，系统自动按以下顺序生成候选键名并依次尝试匹配：

- 清单显式绑定：`actiondock.json` 中该项声明的 `env` 字段（支持单个变量名或优先级数组）。
- 带包名前缀的大写蛇形变量：
  - `ACTIONDOCK_TEAM4U_GITHUB_TOOLS_API_KEY`
  - `ACTIONDOCK_TEAM4U_GITHUB_TOOLS__API_KEY`
  - `TEAM4U_GITHUB_TOOLS_API_KEY`
  - `TEAM4U_GITHUB_TOOLS__API_KEY`
- 带包名缩写（Slug）前缀的大写蛇形变量（当缩写与全名不同时）：
  - `ACTIONDOCK_GITHUB_TOOLS_API_KEY`
  - `ACTIONDOCK_GITHUB_TOOLS__API_KEY`
  - `GITHUB_TOOLS_API_KEY`
  - `GITHUB_TOOLS__API_KEY`
- 标准大写蛇形变量：
  - `API_KEY`
- 原始键名精确匹配：
  - `apiKey`

### 环境变量类型强转机制

从 `process.env` 读取的数据均为原始字符串，系统按以下规则进行类型强转：

- 显式声明或推断类型为数值（`type: "number"` 或 `default` 为数字）：将字符串转为数值（`Number(trimmed)`）；若非有效数值则回退保留原始字符串。
- 显式声明类型为布尔（`type: "boolean"` 或 `default` 为布尔）：`"true"`、`"1"`、`"yes"`、`"on"` 转为 `true`；`"false"`、`"0"`、`"no"`、`"off"` 转为 `false`。
- 显式声明类型为对象或数组（`type: "object"` 或 `type: "array"`）：尝试通过 `JSON.parse` 反序列化。
- 未声明类型时的智能自动探测：
  - 仅自动识别布尔值（`"true"` 与 `"false"`）及 JSON 对象与数组字符串（以 `{` 开头并以 `}` 结尾，或以 `[` 开头并以 `]` 结尾）。
  - 普通数字字符串（如 `"12345"`）在未显式声明为数值类型时保持字符串形态，杜绝非预期的隐式数值转换破坏字符串语义。

---

## actiondock.json 配置声明规范

在 `actiondock.json` 中声明项目依赖的配置项：

```json
{
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "2.0.0",
  "config": {
    "GITHUB_TOKEN": {
      "type": "string",
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "required": true,
      "env": ["GITHUB_TOKEN", "GH_TOKEN"]
    },
    "TIMEOUT_MS": {
      "type": "number",
      "description": "执行超时毫秒数",
      "default": 5000,
      "allowInvocationOverride": true
    }
  }
}
```

配置定义字段说明：

- `type`：配置项值类型（支持 `string`、`number`、`boolean`、`object`、`array`）。
- `description`：功能描述说明，展示在提示与模式检查中。
- `default`：默认回退值。
- `secret`：是否为敏感信息。若为 true，在日志与 CLI 输出中默认进行掩码遮蔽，自省与导出接口不返回明文。
- `env`：显式绑定的外部环境变量名（支持单个字符串或优先级字符串数组）。
- `required`：是否参与必填诊断。缺失时由 `ad config schema` 报告，不自动阻断 Action 调用。
- `allowInvocationOverride`：元数据声明字段，用于标识配置项是否设计为允许调用级参数临时覆盖。

---

## 通配模板配置声明与匹配规则

配置声明支持包含单个 `*` 的通配模板键（例如 `MYSQL_*`），用于匹配包含 1 个及以上合法字符（字符集限定为 `[A-Za-z0-9_.-]`）的动态具体配置键：

- 键名匹配仲裁优先级：
  - 精确键匹配最高（例如显式声明的 `MYSQL_MASTER` 优先于模板）。
  - 最长字面前缀匹配次之（例如前缀更长的模板优先匹配）。
  - 最长字面后缀匹配保底。
- 模板声明边界约束：
  - 模板声明中严禁配置 `required`、`default` 或 `env` 属性。
  - 模板不枚举仅由环境变量存在的实例；`ad config list` 输出的具体配置键仅来源于持久化存储数据库及固定参数覆盖。
  - 模式与诊断表现：在 `ad config schema` 中，模板条目单独归入 `TEMPLATE` 列并统计匹配计数 `matchCount`，不判定缺失；环境变量满足度体检接口自动跳过模板条目。

---

## 敏感信息脱敏与管理安全视图 (ConfigValueView)

ActionDock 为管理端点与命令行提供统一的只读安全视图结构 `ConfigValueView`，其定义包含以下字段：

- `key`：配置键名。
- `configured`：布尔值。保留非默认来源显式配置语义；仅命中 `default` 声明而无外部或持久化显式写入时，该值仍为 `false`。
- `secret`：布尔值。指示当前配置项是否属于敏感配置。
- `source`：配置生效来源，包括 `package`、`global`、`env`、`default`；CLI 将 `package` 展示为 `project`，旧远端协议无法恢复来源时使用 `remote`。
- `value`：脱敏后的安全值。当顶层配置为敏感项且已生效时，此字段为 `undefined`；若为部分字段敏感的对象，返回已对敏感节点打码的脱敏对象。
- `redactedPaths`：字符串数组。记录被脱敏保护的 JSON 指针路径列表：
  - 顶层配置敏感且存在生效值时，路径为根节点：`[""]`；敏感默认值也适用，即使此时 `configured` 为 `false`。
  - 不存在生效值时，路径为空列表：`[]`。
  - 字段级敏感时，使用标准 JSON 指针格式（例如 `["/password"]`，遵循 `~0` 表示 `~`、`~1` 表示 `/` 的转义规则）。

管理端与执行端表现差异：

- 终端安全展示：CLI 针对整项隐藏的配置输出 `<hidden>` 占位标记，未配置项展示 `<not configured>`。配置管理命令仅输出脱敏安全数据，且不提供明文查看参数；需要原值请在 Action 内通过 `ctx.config.get` 读取。
- 执行上下文原值保障：Action 运行时调用 `ctx.config.get` 仍获取完整未脱敏的真实配置值，若配置存在模式定义，框架按最终生效值执行校验。
- 管理容错与诊断脱敏：管理接口查看历史上写入的旧非法值时，依然能够按模式定义安全脱敏输出，不会被执行期的模式校验所阻断。
- 声明式缺失诊断：`required` 仅作为静态诊断标识；未声明模式的旧配置项以及本地或新协议未声明的配置键保持原有解析行为。

---

## 单次调用参数配置覆盖 (ad run -c)

在调用执行 Action 时，支持通过命令行控制参数传入配置覆盖：

- 语法与解析规则：
  - `-c KEY=value`：等号赋值将值原样保留为纯字符串类型。
  - `-c KEY:=json`：冒号等号赋值执行严格的 JSON 解析，递归要求所有数值必须为有效有限数（`Number.isFinite`）。
- 执行约束：配置覆盖仅在内存中生效，键名按字面处理，点号不生成嵌套对象；语法或 JSON 解析错误将直接以退出码 2 中止执行。该语义在独立运行分发入口中保持完全一致。

---

## 全局配置管理与跨包脱敏并集

当跨多个包使用全局配置或在宿主层面执行管理操作时：

- 脱敏保护取并集：全局管理脱敏视图聚合所有活跃包的有效声明，取敏感保护并集。某个包中针对具体键的非敏感声明，不能撤销或削弱另一个包中模板声明的敏感脱敏保护。
- 包级作用域继承：包继承全局配置值时，享有完全同等的脱敏保护；Action 业务逻辑获取的原始值不受任何影响。
- 全局写入模式校验：执行全局 `ad config set -g` 时，值必须通过所有匹配该键的已注册包模式校验。若发生跨包模式规则冲突，应在各包作用域内分别执行包级写入，而非随机挑选某一包的模式。

---

## 降级回退与版本兼容预警

- 底层存储保持中立：配置底层存储继续保持不加密、不执行破坏性数据迁移，解析优先级与存储机制保持稳定。
- 版本回退安全防线：在将当前运行环境回退降级至旧版本 ActionDock 之前，管理员必须为所有已持久化保存的模板实例显式补充具体键的 `secret: true` 清单声明，否则缺乏通配模板支持的旧版本将会导致已存实例明文泄露。
- 对外声明信息脱敏：对外公布的清单声明严禁携带敏感 `default` 默认值或暴露真实敏感凭证的枚举约束，确保在 `ad info` 与模式导出时不泄露任何凭据。
