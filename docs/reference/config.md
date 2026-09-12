# 参考手册：配置解析机制 (Config)

ActionDock 提供了强类型、多层级回退的配置管理机制，使得 Action 在本地调试、自动化测试与多环境部署中保持灵活性与安全性。

---

## 配置解析优先级

当 Action 内调用 `ctx.config.get("API_KEY")` 时，执行引擎按如下严格顺序逐级寻找配置，一旦命中即刻返回：

```text
单次调用参数覆盖
        CLI: --config API_KEY=xxx
        HTTP: body.config = { API_KEY: "xxx" }
        （需配置项声明 allowInvocationOverride: true 或未显式禁止）
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

## CLI 配置作用域规则 (ad config set)

- 包内执行（默认）：若当前目录或父级存在 `actiondock.json`，`ad config set <KEY> <VALUE>` 写入当前包独立的持久化存储空间。
- 全局配置（-g / --global）：使用 `ad config set -g <KEY> <VALUE>` 写入全局存储空间，跨所有包共享。
- 项目外执行：在任意非 Action Package 目录下执行 `ad config set`，将自动写入全局存储。
- 查看配置：`ad config list`（展示当前包合并视图，敏感配置默认掩码），`ad config list -g`（仅查看全局配置）。明文查看敏感项需附加 `--reveal` 参数。

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
- `required`：是否为必填项。若缺失且无默认值，调用前校验返回配置缺失异常。
- `allowInvocationOverride`：是否允许在单次调用中通过调用参数临时覆盖。
