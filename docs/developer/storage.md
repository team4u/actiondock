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
- 敏感配置加密密钥：静态加密密钥优先取环境变量 `ACTIONDOCK_ENCRYPTION_KEY`（64 位十六进制），否则使用密钥文件 `<dataDir>/keys/config.key` 或 `~/.actiondock/keys/config.key`；没有敏感配置时不加载也不创建密钥。密钥文件与数据库配套使用，丢失后密文不可恢复，换用另一把有效密钥会被数据库内的密钥身份指纹拒绝。

---

## 敏感配置静态加密模型

配置表按声明实施整键静态加密，其余表保持明文中立：

- 加密判定与格式：当前声明判定敏感的配置键（顶层 `secret: true` 或内嵌模式字段级敏感）在持久化时整键加密。密文以 `adenc:v1:<密钥指纹>:<密文>` 存于 `value_json`，采用 Node 原生 AES-256-GCM，认证附加数据绑定加密版本、密钥指纹、存储作用域与键名，防止密文被跨作用域或跨键挪用，不阻止同作用域同键密文的跨文件复制或回放、不承诺防回滚；明文值与历史保护声明一同加密封装，外部明文元数据不携带 `default`、`enum` 等声明值。非敏感配置值仍为明文 JSON；`state`、`runs` 等其他表不加密。
- 读取与脱敏：存储层透明解密后返回业务原值，管理视图将历史保护声明与当前声明合并脱敏，历史保护不足时保守整项隐藏；已加密行无论当前声明如何都严格解密，非法密文直接报错，不降级为原文。
- 写入保护：已加密行后续写入保持加密且保护声明只能合并增强，不回退降级为明文；当前版本库中后来才被新声明判定敏感的存量明文，在该键下一次正常敏感写入时转为密文，没有匹配声明的配置不会被推测为敏感。
- 底层调用责任：配置管理端口负责解析清单并传递敏感声明；直接调用 `RuntimeStorage.setConfig(key, value, { declarations })` 时，调用方须显式传入有效声明，未传声明的新键按普通配置保存。已加密键即使不再传声明也继续加密并保留历史保护。自定义存储实现需要自行履行持久化加密与快照读取契约。
- 密钥注入与测试：`createNodePlatform({ configKeyProvider })` 与 `new SqliteRuntimeStorage({ configKeyProvider, ... })` 支持显式注入同步密钥提供器。加密集成测试可用 `createConfigKeyProvider({ key: fixedTestKey })` 注入固定的 32 字节测试密钥，此路径不读取环境或密钥文件；数据库与密钥文件必须使用临时目录。`MemoryStorage` 继续使用纯内存存储，无需真实密钥。

### 数据库版本与自动迁移

数据库版本代表存储结构，与是否写入过密文无关。v3 是当前版本：新建库直接以 v3 结构创建；v2 旧库在新版程序首次打开时由存储启动迁移自动升级；已是 v3 的库直接使用，不重跑旧版转换。v3 库中非敏感配置的明文 JSON 与敏感配置的密文都是当前合法行格式。

打开数据库时，版本准备遵循同一条短路径：读取存储版本，新库创建当前版本结构，旧库在写事务内执行对应迁移，完成后才把数据库交给正常读写代码，因此业务存储实现无需感知旧版本。

迁移是独立的存储启动能力，与正常读写代码隔离，目录结构保持很小：

```text
storage/
  sqlite-schema.ts          # 当前版本结构
  sqlite-config.ts          # 当前版本配置读写
  migrations/
    index.ts                # 通用版本调度器
    v2-to-v3.ts             # v2 升级的全部转换逻辑
```

- 通用调度器只认识版本与迁移函数：在写事务中重新读取版本、按注册表顺序执行转换、成功后提交；缺少迁移路径、版本过新或转换失败时明确报错并回滚，不留下半升级状态。
- `v2-to-v3.ts` 集中封装 v2 的全部旧知识：按传入配置声明识别存量敏感明文（具体键优先于通配模板，全局库取已加载包声明的并集），在同一事务内加密并保留业务原值与更新时间戳、记录密钥指纹、升级版本号。静态发现操作（`ad info`、`ad list` 等）不打开数据库，不触发迁移。
- 迁移需要的声明与密钥提供器由现有存储装配入口传入：`SqliteRuntimeStorage` 支持可选 `configDeclarations`，Host 与 PackageRuntime 已完成装配，全局库取已加载包声明的并集。
- 将来停止支持 v2 直接升级时，删除 `migrations/v2-to-v3.ts` 及其注册项与对应测试即可，当前版本读写代码无需修改；届时遇到 v2 库将报告版本不受支持，提示先用仍包含该迁移的版本升级。

### 安全承诺边界与回退

- 存储保证敏感写入及自动迁移识别出的敏感行以密文保存；不承诺擦除数据库旧页、历史 WAL、既有备份、文件系统快照或底层物理介质中的历史明文副本，也不自动创建备份。历史明文残留的物理清理归入运维维护职责。
- 回退降级须使用自行保留的 v2 备份库恢复（无需密钥）；旧版本程序只接受 v2，会明确拒绝打开 v3 库。数据库版本检查发生在打开连接时，已打开的旧版连接不会因版本变化自动退出；同一数据库的宿主进程应统一升级，迁移前停止旧版宿主，不支持新旧版本并行读写同一库。密钥丢失后密文不可恢复。

---

## 核心数据模型

SQLite 数据库以当前 v3 结构初始化六张表与关联索引：

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
  origin_json TEXT,
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

-- 运行事件表
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(package_id, event_type);

-- 加密密钥身份元数据表（单行约束）
CREATE TABLE IF NOT EXISTS config_encryption (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

其中 `runs` 表的 `host_pid` 与 `heartbeat_at` 两列是运行记录的存活判定依据：前者登记写入方宿主进程标识（供跨进程探测判定，防止并发打开同一数据目录时误收割在途记录），后者记录最后一次心跳刷新时间（供无进程标识的遗留记录做宽限期兜底判定）；`origin_json` 记录调用来源元数据（如入口通道与视图），支撑 `ad runs list --channel` 与 `--view` 过滤；旧库缺失的列与表由版本迁移补齐。`idempotency_keys` 表的 `request_id` 列同时支撑反向查询：`ad runs list --request-id` 与 `ad runs watch --request-id` 均经该表反查关联运行记录。`config_encryption` 是 v3 结构的密钥元数据表，单行约束钉住密钥身份指纹；尚未需要加密的库可以没有指纹记录，首次需要加密时写入。

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
