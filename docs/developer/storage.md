# 实践指南：SQLite 存储与状态管理

ActionDock 2.x 采用内嵌式 SQLite 作为持久化存储后端。
底层基于 Node.js 原生 `node:sqlite`，无需外部服务。
存储层遵循同步驱动契约 `SqliteDriver`。
主线程驱动配合 WAL 模式与超时控制，保障并发读写。
系统提供租约锁协议与自动恢复机制。

---

## 数据目录租约锁与崩溃恢复机制

为防止多进程并发操作同一目录，ActionDock 采用租约锁。
租约锁基于 `.actiondock.data.lock` 排他锁文件实现。

### 排他租约锁结构

数据目录下维护 `.actiondock.data.lock` 文件。
文件记录持有锁的主机与进程元数据：
- `pid`：持有锁的宿主进程标识符。
- `hostname`：宿主主机名。
- `sessionToken`：宿主会话令牌。
- `createdAt`：排他锁创建时间戳。
- `childPids`：关联存活的受管子进程列表。
- `hostSessionId`：宿主会话标识。

### 仲裁规则与错误码

启动阶段尝试获取数据目录排他锁时，遵循以下仲裁判定：

- **空闲目录正常加锁**：若锁文件不存在，原子写入元数据并持有排他锁。
- **活跃冲突拦截（DATA_DIR_IN_USE）**：若锁文件存在，系统探测原进程存活性。若原进程仍存活，系统抛出 `DATA_DIR_IN_USE` 错误拒绝启动。
- **子进程残留保护（DATA_DIR_RECOVERY_REQUIRED）**：主进程已退出但子进程仍存活时，系统抛出 `DATA_DIR_RECOVERY_REQUIRED` 错误。用户需清理孤儿进程或恢复数据。
- **崩溃自动恢复**：原进程与子进程均退出时，当前进程自动接管排他锁。系统清理残留旧会话并重写锁文件，完成自动恢复。
- **受管子进程动态登记**：派生外部受管任务时，自动向租约锁登记子进程标识。子进程结束时自动注销，确保生命周期受控。

---

## 存储文件路径规则

ActionDock 区分运行期数据库存储与用户级全局资产：

- 包级持久化存储：包数据存储于 `~/.actiondock/data/<package-id>/runtime.db`。若指定 `--data-dir <path>` 则重定向至对应目录。
- 全局共享配置存储：全局配置存储于 `~/.actiondock/global.db`。若指定 `--data-dir <path>` 则重定向至对应目录。
- 用户级全局资产隔离：环境配置与证书存放在用户根目录下。若需测试隔离，配置环境变量 `ACTIONDOCK_HOME=<path>` 重定向资产。
- 敏感配置加密密钥：密钥优先取环境变量 `ACTIONDOCK_ENCRYPTION_KEY`。密钥也可从 `<dataDir>/keys/config.key` 读取。无敏感配置时不加载密钥。密钥丢失后密文无法恢复。指纹不匹配时数据库拒绝访问。

---

## 敏感配置静态加密模型

配置表按声明实施整键静态加密，其余表保持明文中立：

- 加密判定与格式：敏感配置键在持久化时整键加密。密文以 `adenc:v1:<密钥指纹>:<密文>` 存储于 `value_json`。系统采用 Node 原生 AES-256-GCM。认证数据绑定加密版本、密钥指纹、存储作用域与键名。明文值与历史保护声明一同加密封装。非敏感配置仍为明文 JSON。`state` 与 `runs` 表不加密。
- 读取与脱敏：存储层解密后返回业务原值。管理视图将历史保护声明与当前声明合并脱敏。历史保护不足时整项隐藏。已加密行严格解密。非法密文直接抛出错误，不降级为原文。
- 写入保护：已加密行后续写入保持加密。保护声明只能合并增强，不降级为明文。存量明文在下次敏感写入时转为密文。无匹配声明的配置不推测为敏感。
- 底层调用责任：配置管理端口解析清单并传递敏感声明。调用 `RuntimeStorage.setConfig` 时调用方需传入有效声明。未传声明的新键按普通配置存储。已加密键继续加密并保留历史保护。自定义存储需履行加密契约。
- 密钥注入与测试：平台支持注入同步密钥提供器。加密集成测试可用 `createConfigKeyProvider({ key: fixedTestKey })` 注入测试密钥。该路径不读取环境或密钥文件。测试数据库与密钥文件需使用临时目录。`MemoryStorage` 使用纯内存存储，无需真实密钥。

### 数据库版本与自动迁移

数据库版本代表存储结构。v3 是当前版本。
新库直接以 v3 结构创建。
v2 旧库首次打开时自动升级。
已是 v3 的库直接使用。
明文 JSON 与敏感配置密文均为合法行格式。

打开数据库时，系统读取存储版本。
新库创建当前版本结构。
旧库在写事务内运行迁移。
完成后交付数据库，业务无需感知旧版本。

迁移是独立的存储启动能力，与读写代码隔离：

```text
storage/
  sqlite-schema.ts          # 当前版本结构
  sqlite-config.ts          # 当前版本配置读写
  migrations/
    index.ts                # 通用版本调度器
    v2-to-v3.ts             # v2 升级的全部转换逻辑
```

- 通用调度器识别版本与迁移函数。调度器在写事务中运行迁移并提交。缺少迁移路径或转换失败时回滚并报告错误。
- `v2-to-v3.ts` 封装旧版本转换规则。转换按配置声明识别存量敏感明文。同一事务内完成加密、记录密钥指纹并升级版本。静态发现操作不打开数据库，不触发迁移。
- 迁移所需的声明与密钥提供器由装配入口传入。`SqliteRuntimeStorage` 支持可选 `configDeclarations`。
- 停止支持升级时，删除对应转换逻辑即可。此时当前版本代码无需修改。遇到旧版库将提示使用过渡版本升级。

### 安全承诺边界与回退

- 存储保证敏感写入以密文存储。框架不擦除旧页、WAL 与历史副本，也不自动创建备份。清理历史副本属于运维职责。
- 回退降级须使用保留的备份库恢复。旧版本程序只接受对应版本库。数据库版本校验在打开连接时进行。迁移前需停止旧版宿主。不支持跨版本并行读写。密钥丢失后密文无法恢复。

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

`runs` 表的 `host_pid` 与 `heartbeat_at` 用于判定记录存活。
`host_pid` 登记宿主进程标识，防止误收割在途记录。
`heartbeat_at` 记录心跳刷新时间，用于宽限期兜底判定。
`origin_json` 记录调用来源元数据，支撑通道与视图过滤。
旧库缺失的列与表由版本迁移补齐。
`idempotency_keys` 表的 `request_id` 支撑反向查询。
`config_encryption` 表约束密钥身份指纹。首次需要加密时写入记录。

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
# 写入状态（支持复合 Key、-P 指定 Package 或 -n 指定命名空间）
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

# 删除状态（智能匹配复合 Key 或命名空间；不存在时非零退出码报告错误）
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

为防止记录撑满磁盘，ActionDock 内置双重保留策略：

- 时间保留策略：默认保留 14 天（`DEFAULT_RUNS_RETENTION_MS`）。超时记录自动清理。
- 数量保留策略：每包最多保留 5000 条终态记录（`DEFAULT_MAX_RUNS_PER_PACKAGE`）。超出上限淘汰旧记录。
- 最小保底机制：清理时默认保底保留最新 50 条记录（`DEFAULT_MIN_RETAIN_RUNS`）。这可防止历史记录完全清空。
- 状态安全隔离：清理仅淘汰终态记录。在途任务不会删除。
- 定期巡检机制：
  - 常驻服务：启动 `ad serve` 时，后台挂载巡检定时器（默认每小时一次）。
  - 短时任务：初始化数据库或写入达到阈值时，触发防抖清理。
- 策略配置覆盖：
  - 通过配置系统持久化配置：`ad config set runs.retentionDays 30` 或 `ad config set runs.maxRuns 10000`。
  - 通过环境变量覆盖：`ACTIONDOCK_RUNS_RETENTION_DAYS`、`ACTIONDOCK_RUNS_MAX_COUNT` 与 `ACTIONDOCK_RUNS_MIN_RETAIN`。
