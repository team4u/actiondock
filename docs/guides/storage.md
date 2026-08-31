# 实践指南：SQLite 存储与状态管理

ActionDock 2.0 采用内嵌式 SQLite（基于 `bun:sqlite`）作为零依赖持久化存储后端，无需安装 MySQL、Redis 或任何外部服务。

---

## 1. 存储文件路径规则

- **开发态（Development）**：存储于项目根目录下的 `.actiondock/actiondock.db`，跟随项目隔离。
- **独立编译态（Standalone Binary）**：存储于当前用户主目录 `~/.actiondock/data/<package-id>.db`。

---

## 2. 数据模型

SQLite 数据库内维护三张核心表：

```sql
-- 1. 持久化配置表
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. 状态持久化表 (支持命名空间与 TTL 过期)
CREATE TABLE IF NOT EXISTS state (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (namespace, key)
);

-- 3. 运行历史表
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

## 3. CLI 管理命令

### A. 配置管理 (`ac config`)
```bash
ac config set GITHUB_TOKEN "ghp_xxx"
ac config get GITHUB_TOKEN
ac config list
ac config delete GITHUB_TOKEN
```

### B. 状态管理 (`ac state`)
```bash
ac state set last_id 100 --ttl 3600
ac state get last_id
ac state list
ac state delete last_id
```

### C. 运行历史管理 (`ac runs`)
```bash
ac runs list --limit 20
ac runs get 01JM8A...
ac runs clean --older-than 7d
```
