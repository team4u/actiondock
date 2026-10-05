# 实践指南：SQLite 存储与状态管理

ActionDock 2.x 采用内嵌式 SQLite（基于 Node.js 原生 `node:sqlite`）作为零依赖持久化存储后端，无需安装外部服务。存储层遵循严格的同步驱动契约（`SqliteDriver`），默认使用主线程同步驱动配合 WAL 模式与忙等待超时保障读写并发，并建立了严格的数据目录租约锁协议与故障自愈机制。

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

ActionDock 区分运行期数据库存储与用户级全局资产：

- 包级持久化存储：包内数据统一存储于 `~/.actiondock/data/<package-id>/runtime.db`（若显式指定 `--data-dir <path>` 则重定向至 `<path>/<package-id>/runtime.db`）。
- 全局共享配置存储：全局键值配置存储于 `~/.actiondock/global.db`（若显式指定 `--data-dir <path>` 则重定向至 `<path>/global.db`）。
- 用户级全局资产隔离：环境配置文件（`profiles.json`）、全局软链接注册表（`registry.json`）与本地通信证书（`certs/`）统一存放在 ActionDock 用户根目录下。若需对其进行测试隔离或多租户沙箱隔离，需设置环境变量 `ACTIONDOCK_HOME=<path>`，此时所有根目录资产将重定向至 `<path>/.actiondock/`。

---

## 核心数据模型

SQLite 数据库在初始化时原子创建四张核心表与关联索引：

```sql
-- 持久化配置表
CREATE TABLE IF NOT EXISTS config (
  package_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, key)
);

-- 状态持久化表 (支持命名空间与 TTL 过期)
CREATE TABLE IF NOT EXISTS state (
  package_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (package_id, namespace, key)
);

-- 运行历史记录表
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  root_run_id TEXT NOT NULL,
  parent_run_id TEXT,
  package_id TEXT NOT NULL,
  package_instance_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  host_session_id TEXT,
  host_pid INTEGER,
  heartbeat_at TEXT,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runs_action ON runs(package_id, action_id);
CREATE INDEX IF NOT EXISTS idx_runs_root ON runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_host_session ON runs(host_session_id);
CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at);

-- 幂等去重键表
CREATE TABLE IF NOT EXISTS idempotency_keys (
  owner_id TEXT NOT NULL,
  action_ref TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, action_ref, request_id)
);
CREATE INDEX IF NOT EXISTS idx_idemp_run ON idempotency_keys(run_id);
```

其中 `runs` 表的 `host_pid` 与 `heartbeat_at` 两列是运行记录的存活判定依据：前者登记写入方宿主进程标识（供跨进程探测判定，防止并发打开同一数据目录时误收割在途记录），后者记录最后一次心跳刷新时间（供无进程标识的遗留记录做宽限期兜底判定）；旧库升级时以可空列兼容补充。`idempotency_keys` 表的 `request_id` 列同时支撑反向查询：`ad runs list --request-id` 与 `ad runs watch --request-id` 均经该表反查关联运行记录。

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

# 按幂等请求标识反查运行记录（可重复传入多个）
ad runs list --request-id <requestId> [-P <pkg>]

# 查看运行记录详情（自动跨本地项目与 linked packages 查找）
ad runs show 01JM8A... [-P <pkg>]

# 阻塞等待一个或多个运行到达终态后聚合退出（支持 --request-id 反查等待）
ad runs watch 01JM8A... 01JN2B... [-P <pkg>]
ad runs watch --request-id <requestId> [-P <pkg>] [--timeout 10m]

# 取消运行中的任务
ad runs cancel 01JM8A... --profile <name>

# 清理运行记录（支持指定保留时长与保留条数）
ad runs clear                                # 清空当前包的所有运行记录
ad runs clear --older-than 14d               # 仅清理超过 14 天的运行记录
ad runs clear --keep 500                     # 保留最新的 500 条记录，清理其余记录
ad runs clear --older-than 7d --keep 100     # 清理 7 天前记录，但至少保底保留最新 100 条
ad runs clear -a "deploy" --status failed    # 仅清理特定动作失败状态的历史记录
```

### 运行记录保留策略与自动清理机制

为了防止高频调用撑满磁盘空间，ActionDock 内置了时间与数量双重保留策略：

- 时间保留策略：默认保留 14 天（`DEFAULT_RUNS_RETENTION_MS`），超过保留时长的终态记录会被自动淘汰。
- 数量保留策略：单个包默认保留最多 5000 条终态记录（`DEFAULT_MAX_RUNS_PER_PACKAGE`），超出上限时按时间先后淘汰最旧的记录。
- 最小保底机制：时间过期清理时默认保底保留最近的 50 条记录（`DEFAULT_MIN_RETAIN_RUNS`），防止低频调用场景下历史记录被完全清空。
- 状态安全隔离：清理机制严格仅淘汰终态记录（`success`、`failed`、`cancelled`、`timed_out`、`interrupted`），在途运行的任务不会被误删。
- 定期巡检机制：
  - 常驻服务：在启动 `ad serve` 时，后台会自动挂载轻量级巡检定时器（默认每 1 小时巡检一次），周期性调用清理逻辑。
  - 短时执行：在持有者进程初始化数据库（会话接管恢复时点）以及写入达到批次阈值时，自动触发机会性防抖清理。
- 策略配置覆盖：
  - 通过配置系统持久化设置：`ad config set runs.retentionDays 30` 或 `ad config set runs.maxRuns 10000`。
  - 通过环境变量覆盖：`ACTIONDOCK_RUNS_RETENTION_DAYS`、`ACTIONDOCK_RUNS_MAX_COUNT` 与 `ACTIONDOCK_RUNS_MIN_RETAIN`。
