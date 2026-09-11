# 实践指南：SQLite 存储与状态管理

ActionDock 2.0 采用内嵌式 SQLite（基于 Node.js 原生 `node:sqlite`）作为零依赖持久化存储后端，无需安装外部服务。存储层遵循严格的同步驱动契约（`SqliteDriver`），默认使用主线程同步驱动配合 WAL 模式与忙等待超时保障读写并发；另提供基于专用后台工作线程的异步驱动 WorkerSqliteDriver 作为独立组件，并建立了严格的数据目录租约锁协议与故障自愈机制。

---

## 异步存储驱动：WorkerSqliteDriver

在高并发任务与流式交互场景下，若需要将密集 SQLite 操作卸载出主线程，可将 WorkerSqliteDriver 作为独立异步驱动直接使用（不注入同步存储契约）。

### 专用工作线程隔离机制

- **专用后台线程执行**：`WorkerSqliteDriver` 基于 Node.js `node:worker_threads` 创建独立的专用工作线程，将所有底层 SQLite 磁盘读写与查询操作完全卸载至后台工作线程中执行。
- **主事件循环零阻塞**：主线程仅通过消息通道发起请求并接收结果，对外提供完全异步的语句接口（`WorkerSqliteStatement` 提供 `run`、`get`、`all` 异步方法）。主事件循环零阻塞，彻底杜绝了数据库慢查询或锁竞争导致整个进程失去响应的问题。
- **预写日志模式加固**：工作线程内数据库连接默认开启预写日志模式（`PRAGMA journal_mode = WAL;`）、外键约束检查（`PRAGMA foreign_keys = ON;`）以及 5000 毫秒忙等待超时（`PRAGMA busy_timeout = 5000;`），实现高效读写并发。

---

## 数据目录租约锁与崩溃恢复机制

为了防止多个宿主进程并发操作同一数据存储目录导致数据库损坏，ActionDock 实现了基于 `.actiondock.data.lock` 排他锁文件的租约协议与崩溃自动恢复机制。

### 排他租约锁结构

在数据存储目录下，系统原子维护 `.actiondock.data.lock` 文件，记录当前持有锁的主机与进程元数据：
- `pid`：持有锁的宿主进程标识符。
- `hostname`：宿主主机名。
- `sessionToken`：宿主会话令牌。
- `createdAt`：排他锁创建时间戳。
- `childPids`：关联存活的受管子进程列表。
- `hostSessionId`：宿主会话标识。

### 仲裁规则与错误码

启动阶段尝试获取数据目录排他锁时，严格遵循以下仲裁判定：

- **空闲目录正常加锁**：若锁文件不存在，原子写入当前宿主元数据并持有排他锁。
- **活跃冲突拦截（DATA_DIR_IN_USE）**：若锁文件已存在，系统通过操作系统系统调用（`process.kill(pid, 0)`）探测原宿主进程存活性。若原宿主进程仍处于存活状态，系统立即抛出 `DATA_DIR_IN_USE` 错误拒绝启动，坚决防止多实例并发踩踏。
- **子进程残留保护（DATA_DIR_RECOVERY_REQUIRED）**：若原宿主主进程已退出，但锁元数据中登记的关联受管子进程（`childPids`）仍有残留存活，系统抛出 `DATA_DIR_RECOVERY_REQUIRED` 错误，提示需要清理残留孤儿进程或进行数据恢复。
- **崩溃自动恢复**：若原宿主进程与其所有子进程均已退出（表明此前发生过非正常宕机或崩溃），当前宿主进程将自动接管排他锁，清理残留旧会话并重写锁文件，实现零人工介入的自动容灾恢复。
- **受管子进程动态登记**：宿主进程派生外部受管任务时，自动向当前租约锁登记子进程标识（`registerChildPid`），子进程结束时自动注销（`unregisterChildPid`），确保子进程生命周期受控。

---

## 存储文件路径规则

- **包级存储**：包内数据统一存储于 `~/.actiondock/data/<package-id>/runtime.db`（若显式指定 `--data-dir <path>` 则为 `<path>/<package-id>/runtime.db`）。
- **全局共享存储**：存储于用户主目录下的 `~/.actiondock/global.db`，跨所有 Action Package 共享公共配置（如全局 API Token）。

---

## 核心数据模型

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

### 配置管理 (`ad config`)

```bash
# 包级配置（默认写入 ~/.actiondock/data/<package-id>/runtime.db）
ad config set GITHUB_TOKEN "ghp_xxx"
ad config get GITHUB_TOKEN
ad config list
ad config delete GITHUB_TOKEN

# 全局共享配置（写入 ~/.actiondock/global.db，跨 Package 共享）
ad config set -g OPENAI_API_KEY "sk-xxx"
ad config list -g
```

### 状态管理 (`ad state`)

```bash
# 设置状态（支持复合 Key、-P 指定 Package 或 -n 指定命名空间）
ad state set last_id 100 --ttl 3600
ad state set "auth:session" "token_123" --ttl 7200
ad state set "session" "token_123" -n "auth" --ttl 7200
ad state set "session" "token_123" -P "my-pkg" -n "auth" --ttl 7200

# 读取状态（支持跨包指定 -P 或使用 package/key 语法）
ad state get last_id
ad state get "auth:session"
ad state get "session" -n "auth" -P "my-pkg"

# 列出状态（项目内列出当前包状态；外部目录自动汇总所有 linked packages 的状态键）
ad state list
ad state list -P "my-pkg" -n "auth"
ad state list --detail --json

# 删除状态（智能匹配复合 Key 或命名空间；不存在时非零退出码报错）
ad state delete last_id
ad state delete "auth:session"
ad state delete "session" -n "auth" -P "my-pkg"

# 批量清理状态
ad state clear -n "auth"      # 清空 auth 命名空间下的所有缓存
ad state clear --all          # 清空该 package 下的所有状态
```

### 运行历史管理 (`ad runs`)

```bash
# 查看调用历史（支持 -P 过滤特定包，外部目录自动聚合所有 linked packages）
ad runs list --limit 20 [-P <pkg>] [-i <intent>]

# 查看运行记录详情（自动跨本地项目与 linked packages 查找）
ad runs show 01JM8A... [-P <pkg>]

# 取消运行中的任务
ad runs cancel 01JM8A... --profile <name>
```
