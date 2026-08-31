# 参考手册：配置解析机制 (`Config`)

ActionDock 提供了强类型、多层级回退的配置管理机制，使得 Action 在本地调试、CI/CD 与多环境部署中保持灵活性与安全性。

---

## 1. 六级配置解析优先级

当 Action 内调用 `ctx.config.get("API_KEY")` 时，执行引擎按如下严格顺序逐级寻找配置，一旦命中即刻返回：

```text
第 1 级：调用时参数覆盖 (Invocation Override)
        CLI: --config API_KEY=xxx
        HTTP: body.config = { API_KEY: "xxx" }
        ↓
第 2 级：项目级 SQLite 持久化配置 (.actiondock/storage.db)
        在项目目录下通过 ac config set API_KEY xxx 写入（仅当前项目生效）
        ↓
第 3 级：全局级 SQLite 持久化配置 (~/.actiondock/global.db)
        通过 ac config set -g API_KEY xxx 写入（跨所有 Action Package 共享）
        ↓
第 4 级：环境变量 (Environment Variables)
        依序查找：
        a. actiondock.json 中声明的 env 映射
        b. 包命名空间环境变量：<PACKAGE_ID>__<KEY>
        c. 全局环境变量：<KEY>
        ↓
第 5 级：项目默认配置 (Project Defaults)
        actiondock.json -> config.<KEY>.default
        ↓
第 6 级：代码内联默认值 (Code Fallback)
        ctx.config.get("API_KEY", "fallback-val")
```

---

## 2. CLI 配置作用域规则 (`ac config set`)

- **项目内执行（默认）**：若当前目录或父级存在 `actiondock.json`，`ac config set <KEY> <VALUE>` 默认写入**当前项目**的本地存储（`.actiondock/storage.db`）。
- **全局配置 (`-g / --global`)**：使用 `ac config set -g <KEY> <VALUE>` 写入全局存储（`~/.actiondock/global.db`），跨所有包共享。
- **项目外执行**：在任意非 ActionDock 项目目录下执行 `ac config set`，将自动回退并写入全局存储。
- **查看配置**：`ac config list`（默认展示当前项目合并视图），`ac config list -g`（仅查看全局配置）。

---

## 3. 环境变量命名与自动类型转换

### 包前缀匹配规则
若 packageId 为 `team4u.github-tools`，查询 `API_TOKEN` 时会自动扫描：
- `TEAM4U_GITHUB_TOOLS__API_TOKEN`
- `TEAM4U_GITHUB_TOOLS_API_TOKEN`
- `API_TOKEN`

### 自动类型强转
从环境变量读取的字符串会自动按目标类型尝试转换：
- `"true"` / `"false"` → `boolean`
- 纯数字字符串 `"12345"` → `number`
- JSON 字符串 `{"a": 1}` → `object`

---

## 4. `actiondock.json` 配置声明规范

```json
{
  "packageId": "team4u.github-tools",
  "configSchema": {
    "type": "object",
    "properties": {
      "GITHUB_TOKEN": {
        "type": "string",
        "description": "GitHub 个人访问令牌"
      },
      "TIMEOUT_MS": {
        "type": "number",
        "default": 5000
      }
    },
    "required": ["GITHUB_TOKEN"]
  },
  "defaultConfig": {
    "TIMEOUT_MS": 5000
  }
}
```
