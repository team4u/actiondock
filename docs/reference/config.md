# 参考手册：配置解析机制 (`Config`)

ActionDock 提供了强类型、多层级回退的配置管理机制，使得 Action 在本地调试、持续集成与多环境部署中保持灵活性与安全性。

---

## 配置解析优先级

当 Action 内调用 `ctx.config.get("API_KEY")` 时，执行引擎按如下严格顺序逐级寻找配置，一旦命中即刻返回：

```text
单次调用参数覆盖
        CLI: --config API_KEY=xxx
        HTTP: body.config = { API_KEY: "xxx" }
        ↓
包级 SQLite 持久化配置数据库
        通过 ad config set API_KEY xxx 写入（当前包独享）
        ↓
全局级 SQLite 持久化配置数据库
        通过 ad config set -g API_KEY xxx 写入（跨所有 Action Package 共享）
        ↓
操作系统环境变量与环境配置文件 (.env)
        查找顺序：
        - actiondock.json 中声明的 env 映射
        - 包命名空间环境变量：<PACKAGE_ID>__<KEY>
        - 全局环境变量：<KEY>
        ↓
项目清单默认配置声明
        actiondock.json -> config.<KEY>.default
        ↓
代码内联默认回退值
        ctx.config.get("API_KEY", "fallback-val")
```

---

## CLI 配置作用域规则 (`ad config set`)

- 包内执行（默认）：若当前目录或父级存在 `actiondock.json`，`ad config set <KEY> <VALUE>` 写入当前包独立的持久化存储空间。
- 全局配置（-g / --global）：使用 `ad config set -g <KEY> <VALUE>` 写入全局存储空间，跨所有包共享。
- 项目外执行：在任意非 Action Package 目录下执行 `ad config set`，将自动写入全局存储。
- 查看配置：`ad config list`（展示当前包合并视图，敏感配置默认掩码），`ad config list -g`（仅查看全局配置）。明文查看敏感项需附加 `--reveal` 参数。

---

## 环境变量命名与自动类型转换

### 包前缀匹配规则
若 packageId 为 `team4u.github-tools`，查询 `API_TOKEN` 时会自动按以下优先级扫描环境变量：
- `TEAM4U_GITHUB_TOOLS__API_TOKEN`
- `TEAM4U_GITHUB_TOOLS_API_TOKEN`
- `API_TOKEN`

### 自动类型强转
从环境变量读取的字符串会自动按目标类型尝试转换：
- `"true"` 与 `"false"` 转为布尔型
- 纯数字字符串 `"12345"` 转为数值型
- JSON 字符串 `{"key": "value"}` 转为对象或数组

---

## `actiondock.json` 配置声明规范

在 `actiondock.json`（规范版本号为 2）中声明项目依赖的配置项：

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
      "env": "GITHUB_TOKEN"
    },
    "TIMEOUT_MS": {
      "type": "number",
      "description": "执行超时毫秒数",
      "default": 5000
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
- `required`：是否为必填项。若缺失且无默认值，校验时返回配置缺失异常。
