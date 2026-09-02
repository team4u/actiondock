# 实践指南：SQLite 存储与状态管理

ActionDock 2.0 采用内嵌式 SQLite（基于 `bun:sqlite`）作为零依赖持久化存储后端，无需安装外部服务。

---

## 存储文件路径规则

- **开发态项目级**：存储于项目根目录下的 `.actiondock/runtime.db`，跟随项目物理隔离。
- **全局共享级**：存储于用户主目录下的 `~/.actiondock/global.db`，跨所有 Action Package 共享公共配置（如全局 API Token）。
- **独立编译态**：独立二进制在目标机器运行时，默认存储于 `~/.actiondock/data/<package-id>/runtime.db`。

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

// 命名空间隔离
const authState = ctx.state.scope("auth");
await authState.set("session_token", "abc-123", 3600);

// 删除状态（返回 boolean 指示是否实际删除了数据）
const deleted = await ctx.state.delete("user_last_seen:1001");

// 批量清理命名空间
const clearedCount = await authState.clear();
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
# 设置状态（支持复合 Key、-P 指定 Package 或 -n 指定命名空间）
ac state set last_id 100 --ttl 3600
ac state set "auth:session" "token_123" --ttl 7200
ac state set "session" "token_123" -n "auth" --ttl 7200
ac state set "session" "token_123" -P "my-pkg" -n "auth" --ttl 7200

# 读取状态（支持跨包指定 -P 或使用 package/key 语法）
ac state get last_id
ac state get "auth:session"
ac state get "session" -n "auth" -P "my-pkg"

# 列出状态（项目内列出当前包状态；外部目录自动汇总所有 linked packages 的状态键）
ac state list
ac state list -P "my-pkg" -n "auth"
ac state list --detail --json

# 删除状态（智能匹配复合 Key 或命名空间；不存在时非零退出码报错）
ac state delete last_id
ac state delete "auth:session"
ac state delete "session" -n "auth" -P "my-pkg"

# 批量清理状态
ac state clear -n "auth"      # 清空 auth 命名空间下的所有缓存
ac state clear --all          # 清空该 package 下的所有状态
```

### 运行历史管理 (`ac runs`)
```bash
# 查看调用历史（支持 -P 过滤特定包，外部目录自动聚合所有 linked packages）
ac runs list --limit 20 [-P <pkg>] [-i <intent>]

# 查看运行记录详情（自动跨本地项目与 linked packages 查找）
ac runs show 01JM8A... [-P <pkg>]

# 取消远端运行中的任务
ac runs cancel 01JM8A... --profile <name>
```

