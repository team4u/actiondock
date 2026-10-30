# 参考手册：配置解析机制 (Config)

ActionDock 提供多层级回退的配置管理机制。Action 在本地调试、自动化测试与多环境部署中保持灵活性与安全性。

---

## 配置解析优先级

当 Action 内调用 `ctx.config.get("API_KEY")` 时，执行引擎按顺序逐级查找配置。一旦命中即刻返回：

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

- 包内执行（默认）：若当前或父级目录存在 `actiondock.json`，`ad config set <KEY> <VALUE>` 写入当前包存储空间。
- 全局配置（-g / --global）：使用 `ad config set -g <KEY> <VALUE>` 写入全局存储空间。跨所有包共享。
- 项目外执行：在非包目录下执行 `ad config set`，自动写入全局存储。
- 查看配置：`ad config list` 展示当前包合并视图并对敏感配置脱敏。`ad config list -g` 仅查看全局配置。系统不提供明文查看参数。
- 写入形态：`ad config set <key> [value] [options] [-- <assignments...>]`。完整位置值必须在 `--` 前。合法 JSON 自动解码。普通文本保留为字符串。仅在 `--` 后识别扁平赋值。`=` 赋值为字符串。`:=` 赋值为严格 JSON。路径与安全校验继承 `ad run`。
- 标准输入注入：`--stdin` 读取全部内容并裁剪末尾换行符，再按 JSON 或字符串解码。空输入报告错误。`--stdin-field <field>` 绑定指定顶层字符串字段。该模式不解析 JSON，保留换行与全部空白。空输入为空字符串。该选项可补充扁平赋值。敏感字段可引用环境变量。完整对象可从文件读取。示例如下：
  ```bash
  printf '%s' "$MYSQL_PASSWORD" | ad config set MYSQL_191 -P db.tools --stdin-field password -- host=localhost port:=3306 username=root
  ad config set MYSQL_191 --stdin < connection.json
  ```
- 浏览器敏感配置录入：`ad config set <key> [-g, --global] [-P <package>] --browser` 通过本地临时页面录入凭据。输入渠道与存储作用域正交。写入后退出，不自动执行 Action。
  - 目标与范围约束：支持本地包级目标与全局配置。系统拒绝显式 `--server` 与 `--profile`。包级寻址失败时报告错误，不退回全局存储。包级匹配目标包声明。全局匹配宿主已加载包声明。要求至少有一项顶层标明 `secret: true` 且显式类型均为 `string`。全局配置跨包共享。同名包级配置优先。
  - 参数互斥：`--browser` 与位置参数值、`--stdin`、`--stdin-field` 及扁平赋值严格互斥。冲突时以退出码 2 报告错误。
  - 声明契约校验：仅支持已声明且顶层为 `secret: true` 的字符串配置。系统拒绝未声明项与非字符串声明。页面支持多行。切换展示状态不改变输入内容。页面保留首尾空白。浏览器将换行符统一为 LF。需要保留原始换行编码时，可通过标准输入写入 JSON 字符串。
  - 安全与生命周期：仅监听 `127.0.0.1` 随机端口。严格校验 Host、Origin 与一次性凭据。JSON 请求体大小上限为 64KiB。页面无外部资源且不回填旧值。输入等待最长 5 分钟。存储阶段等待实际写入结果。
  - 存储边界：敏感配置一律整键静态加密落盘。非敏感配置保持明文存储。`--browser` 仅接受顶层敏感字符串。嵌套敏感对象在其他渠道写入时同样整键加密。URL 片段携带临时提交权限，请勿分享链接。无法自动打开浏览器时，标准错误流提示手动打开链接并继续等待。
- 输入边界：完整位置值、`--stdin` 与结构化模式互斥。`--stdin-field` 仅能与扁平赋值组合。模式冲突在读取或写入前以参数错误退出，退出码为 2。字段绑定不改变敏感性判定。
- 拒绝通配实键：`ad config get`、`ad config set` 与 `ad config delete` 严格拒绝包含通配符 `*` 的实键操作。
- 写入原子性与写前校验：所有输入方式先组装完整值，再严格校验并整键替换。缺少必填字段时校验失败。失败时抛出 `CONFIG_VALUE_INVALID` 错误。原有存储值保持不变。脱敏输出不能直接回写。系统不支持字段级部分更新与对象合并。

---

## 环境变量命名与类型强转

运行时从 `process.env` 解析配置值，不自动加载隐式 `.env` 文件。

### 环境变量候选键匹配规则

若当前包 ID 为 `team4u.github-tools`，查询键名 `apiKey` 时，系统按如下顺序生成候选键名并依次匹配：

- 清单显式绑定：`actiondock.json` 中声明的 `env` 字段（支持单个变量名或优先级数组）。
- 带包名前缀的大写蛇形变量：
  - `ACTIONDOCK_TEAM4U_GITHUB_TOOLS_API_KEY`
  - `ACTIONDOCK_TEAM4U_GITHUB_TOOLS__API_KEY`
  - `TEAM4U_GITHUB_TOOLS_API_KEY`
  - `TEAM4U_GITHUB_TOOLS__API_KEY`
- 带包名缩写（Slug）前缀的大写蛇形变量：
  - `ACTIONDOCK_GITHUB_TOOLS_API_KEY`
  - `ACTIONDOCK_GITHUB_TOOLS__API_KEY`
  - `GITHUB_TOOLS_API_KEY`
  - `GITHUB_TOOLS__API_KEY`
- 标准大写蛇形变量：
  - `API_KEY`
- 原始键名精确匹配：
  - `apiKey`

### 环境变量类型强转机制

从 `process.env` 读取的数据均为原始字符串。系统按以下规则进行类型强转：

- 显式声明或推断类型为数值：将字符串转为数值。若非有效数值则保留原始字符串。
- 显式声明类型为布尔：`"true"`、`"1"`、`"yes"`、`"on"` 转为 `true`。`"false"`、`"0"`、`"no"`、`"off"` 转为 `false`。
- 显式声明类型为对象或数组：通过 `JSON.parse` 解析。
- 未声明类型时的自动探测：
  - 自动识别布尔值以及 JSON 对象或数组字符串。
  - 普通数字字符串保持字符串形态，防止非预期的隐式类型转换。

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
- `description`：功能描述说明，展示在提示与模式校验中。
- `default`：默认回退值。
- `secret`：是否为敏感信息。若为 true，在日志与 CLI 输出中掩码遮蔽，不返回明文。
- `env`：显式绑定的外部环境变量名（支持单个字符串或优先级字符串数组）。
- `required`：是否参与必填诊断。缺失时由 `ad config schema` 报告，不阻断 Action 调用。
- `allowInvocationOverride`：元数据声明字段。标识配置项是否允许单次调用临时覆盖。

---

## 通配模板配置声明与匹配规则

配置声明支持包含单个 `*` 的通配模板键（例如 `MYSQL_*`）。该模板用于匹配动态具体配置键：

- 键名匹配仲裁优先级：
  - 精确键匹配最高。显式声明优先于模板。
  - 最长字面前缀匹配次之。前缀更长的模板优先匹配。
  - 最长字面后缀匹配保底。
- 模板声明边界约束：
  - 模板声明中严禁配置 `required`、`default` 或 `env` 属性。
  - 模板不枚举仅由环境变量存在的实例。具体配置键仅来源于持久化数据库及固定参数覆盖。
  - 模式与诊断表现：在 `ad config schema` 中，模板条目归入 `TEMPLATE` 列并统计 `matchCount`。诊断时不判定缺失。体检接口自动跳过模板条目。

---

## 敏感信息脱敏与管理安全视图 (ConfigValueView)

ActionDock 为管理端点与命令行提供只读安全视图结构 `ConfigValueView`。其定义包含以下字段：

- `key`：配置键名。
- `configured`：布尔值。表示是否来自显式来源。默认值与未配置均为 `false`。
- `secret`：布尔值。指示当前配置项是否属于敏感配置。
- `source`：配置生效来源，类型为 `ConfigSource`。取值范围为 `override`、`package`、`global`、`env`、`default` 或 `null`：
  - `override`：执行期固定覆盖与单次调用覆盖。
  - `package`：包级持久化存储。
  - `global`：全局持久化存储。
  - `env`：操作系统环境变量命中。
  - `default`：清单声明且生效的默认值。
  - `null`：整链未命中或无生效来源。严禁用 `default` 伪装未配置状态。模板匹配数量单列 `matchCount` 展示。
- `value`：脱敏后的安全值。顶层敏感配置已生效时，此字段为 `undefined`。部分字段敏感的对象返回打码后的脱敏对象。
- `redactedPaths`：字符串数组。记录脱敏保护的 JSON 指针路径列表：
  - 顶层配置敏感且存在生效值时，路径为根节点：`[""]`。
  - 不存在生效值时，路径为空列表：`[]`。
  - 字段级敏感时，使用标准 JSON 指针格式（例如 `["/password"]`）。

管理端与执行端表现差异：

- 终端安全展示：CLI 针对整项隐藏的配置输出 `<hidden>`。未配置项展示 `<not configured>`。配置管理命令仅输出脱敏安全数据，不提供明文查看参数。需要原值请在 Action 内通过 `ctx.config.get` 读取。
- 执行上下文原值保障：Action 运行时调用 `ctx.config.get` 获取完整未脱敏的真实配置值。若配置存在模式定义，框架按最终生效值执行校验。
- 管理容错与诊断脱敏：管理接口查看历史旧值时，依然按模式定义安全脱敏输出。执行期模式校验不会阻断该输出。
- 声明式缺失诊断：`required` 仅作为静态诊断标识。未声明模式的旧配置项保持原有解析行为。

---

## 来源契约与 undefined 未命中语义

- `undefined` 统一视为未命中：任一层值为 `undefined` 时继续向低优先级解析。`null`、`false`、`0` 与空字符串均为真实值并终止解析链。
- 来源准确映射：`RuntimeConfig.describe` 作为五层优先级链的唯一事实源。返回的 `source` 严格对应实际生效层。未命中层级不会标注为来源。
- 远端视图元数据强校验：核心客户端仅接受 `configViewVersion: 1` 的新协议响应。`source` 必须为合法的 `ConfigSource` 值。该值必须与 `configured` 状态自洽。不满足时抛出 `PROTOCOL_UNSUPPORTED` 协议错误。系统不猜测来源，不降级旧协议。单键查询要求服务端返回同键完整视图。无匹配项时服务端返回 `source: null` 视图。客户端不接受列表响应伪装单项未命中。

---

## 单次调用参数配置覆盖 (ad run -c)

执行 Action 时，支持通过命令行参数传入配置覆盖：

- 语法与解析规则：
  - `-c KEY=value`：等号赋值将值保留为纯字符串类型。
  - `-c KEY:=json`：冒号等号赋值执行严格的 JSON 解析。递归要求所有数值必须为有效有限数（`Number.isFinite`）。
- 执行约束：配置覆盖仅在内存中生效。键名按字面处理，点号不生成嵌套对象。语法或解析错误直接以退出码 2 终止执行。独立执行入口保持相同语义。

---

## 全局配置管理与跨包脱敏并集

跨多个包使用全局配置或在宿主层面执行管理操作时：

- 脱敏保护取并集：全局脱敏视图聚合所有活跃包的有效声明。视图取敏感保护并集。某个包的非敏感声明不能削弱另一个包的敏感脱敏保护。
- 包级作用域继承：包继承全局配置值时，享有同等的脱敏保护。Action 业务逻辑获取的原始值不受影响。
- 全局写入模式校验：执行全局 `ad config set -g` 时，配置值必须通过所有匹配包的模式校验。若发生跨包模式冲突，应在各包内分别执行包级写入。

---

## 敏感配置静态加密

持久化配置按声明实施整键静态加密。非敏感配置保持明文 JSON。旧库升级自动完成，无需迁移命令：

- 加密范围与格式：判定为敏感的配置键在写入持久化库时整键加密。算法采用 AES-256-GCM。密文形如 `adenc:v1:<密钥指纹>:<密文>`。认证附加数据绑定版本、指纹、作用域与键名。该设计防止密文跨作用域挪用。系统不承诺防回滚。非敏感配置保持明文。状态存储与执行记录不加密。
- 自动升级：新版程序打开旧版（v2）库时启动自动迁移。迁移在同一事务内将明文敏感配置加密。迁移记录密钥指纹并将数据库升级为 v3。失败时整体回滚并报告错误。新数据库直接以 v3 结构生成。
- 迁移声明来源：迁移按已有配置声明判定敏感键。具体键优先于通配模板。全局库取已加载包声明并集。无匹配声明的配置不判定为敏感。迁移保留业务原值与时间戳。重复打开保持安全。
- 后续声明变化：后续判定为敏感的存量明文，在下一次写入时转为密文。已加密的键后续更新始终保持加密。写入操作不能削弱保护，也不回退为明文。历史保护声明只随加密行存在。解密后合并脱敏。
- 密钥管理：密钥优先取环境变量 `ACTIONDOCK_ENCRYPTION_KEY`。该值必须为 64 位十六进制字符。否则使用密钥文件 `<dataDir>/keys/config.key`。首次需要加密时自动生成密钥文件。无敏感配置时不生成密钥。数据库记录密钥指纹。指纹不匹配时报告 `CONFIG_ENCRYPTION_ERROR`。密文非法时报告 `CONFIG_DECRYPT_FAILED`。密钥丢失后密文不可恢复。密钥文件须与数据库备份分开存储。
- 安全承诺边界：静态加密保证敏感配置以密文存储。系统不擦除旧页、WAL 文件或历史备份中的明文副本。系统不自动生成备份。升级前请自行备份数据。清理物理明文残留属于运维职责。
- 数据库版本：v3 是当前存储结构版本，携带密钥身份元数据。v2 是旧版结构，打开时自动升级。旧版程序拒绝打开 v3 库。版本回退时须使用备份恢复。

---

## 降级回退与版本兼容预警

- 底层存储分层中立：配置存储实施整键静态加密。状态与执行记录等表保持明文。解析优先级与存储机制保持稳定。
- 旧服务端协议约束：远端配置查询要求服务端提供 `configViewVersion: 1` 安全视图。客户端拒绝缺少元数据的旧服务端响应（`PROTOCOL_UNSUPPORTED`）。系统不再执行猜测降级。客户端配置查询拒绝连接旧服务端。
- 版本回退安全防线：执行环境回退至旧版本前，管理员须为模板实例显式补充 `secret: true` 声明。旧版本不支持通配模板，可能导致明文泄露。
- 对外声明信息脱敏：对外公布的清单严禁携带敏感默认值。清单严禁在枚举约束中暴露凭据。`ad info` 与模式导出不泄露凭据。
