# 实践指南：SQLite 存储与状态管理 (Storage & State)

ActionDock 2.0 采用内嵌式 SQLite（基于 `bun:sqlite`）作为零依赖持久化存储后端，无需安装外部服务。

---

## 存储文件路径规则

- **开发态项目级（Project Scope）**：存储于项目根目录下的 `.actiondock/runtime.db`，跟随项目物理隔离。
- **全局共享级（Global Scope）**：存储于用户主目录下的 `~/.actiondock/global.db`，跨所有 Action Package 共享公共配置（如全局 API Token）。
- **独立编译态（Standalone Binary）**：独立二进制在目标机器运行时，默认存储于 `~/.actiondock/data/<package-id>/runtime.db`。

---

## 数据模型

SQLite 数据库内维护三张核心表：

```sql
-- 持久化配置表
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 状态持久化表 (支持命名空间与 TTL 过期)
CREATE TABLE IF NOT EXISTS state (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (namespace, key)
);

-- 运行历史表
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 在 Action 代码中使用 `ctx.state`

```ts
// 写入状态（支持可选 TTL 秒数）
await ctx.state.set("user_last_seen:1001", new Date().toISOString(), 86400);

// 读取状态
const lastSeen = await ctx.state.get<string>("user_last_seen:1001");

// 删除状态
await ctx.state.delete("user_last_seen:1001");
```

---

## CLI 管理命令速查

### 配置管理 (`ac config`)
```bash
# 项目级配置（默认写入当前项目的 .actiondock/runtime.db）
ac config set GITHUB_TOKEN "ghp_xxx"
ac config get GITHUB_TOKEN
ac config list
ac config delete GITHUB_TOKEN

# 全局共享配置（写入 ~/.actiondock/global.db，跨 Package 共享）
ac config set -g OPENAI_API_KEY "sk-xxx"
ac config list -g
```

### 状态管理 (`ac state`)
```bash
ac state set last_id 100 --ttl 3600
ac state get last_id
ac state list
ac state delete last_id
```

### 运行历史管理 (`ac runs`)
```bash
ac runs list --limit 20
ac runs get 01JM8A...
ac runs clean --older-than 7d
```
