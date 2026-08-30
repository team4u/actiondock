# 存储与状态管理机制

ActionDock 2.0 采用极简的嵌入式 SQLite 引擎（`bun:sqlite`）来管理运行态数据。本文档详细介绍存储层的数据模型、路径解析策略、数据库迁移机制以及与状态持久化的最佳实践。

---

## 存储设计原则

* **仅存储运行态数据**：数据库中绝不存储代码、Action 定义或 Playbook 内容（代码和定义全部由文件系统 Filesystem 管理）。
* **轻量与自包含**：通过 Bun 原生内置的 `bun:sqlite` 访问，零外部数据库服务依赖，零网络开销，支持 WAL（Write-Ahead Logging）高并发模式。
* **环境隔离**：开发态与独立二进制态的数据存储位置天然物理隔离，互不干扰。

---

## 数据库物理表结构

ActionDock 存储引擎管理 3 张标准表：

### 运行时配置表 (`config`)
保存本地持久化的配置键值对。

```sql
CREATE TABLE IF NOT EXISTS config (
  package_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, key)
);
```

### 持久化共享状态表 (`state`)
保存跨 Action 执行保留的业务持久化状态，支持命名空间隔离。

```sql
CREATE TABLE IF NOT EXISTS state (
  package_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, namespace, key)
);
```

### 执行历史与调用链记录表 (`runs`)
记录每次 Action 调用的执行详情与父子链路。

```sql
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_action ON runs(package_id, action_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
```

---

## 存储路径解析策略

ActionDock 根据运行模式自动解析 SQLite 数据库文件的存放位置：

| 运行模式 | 默认存储路径 | 可自定义覆盖方式 |
| :--- | :--- | :--- |
| **开发态** (`ac action run`) | `<项目根目录>/.actiondock/runtime.db` | 项目根目录 |
| **独立二进制态** (`./bin/pkg run`) | `~/.actiondock/data/<package-id>/runtime.db` | 全局参数 `--data-dir <path>` |
| **单元测试态** (`createTestRuntime`) | 纯内存模拟（`MemoryStateStore` / `MemoryConfig`） | 内存即测即毁，零磁盘 IO |

### 独立二进制指定数据目录示例
```bash
# 将状态存储重定向到指定的临时目录或容器挂载卷
./bin/github-tools --data-dir /tmp/my-data run github.get-pr --input '{"prNumber": 1}'
```

---

## 数据库版本迁移机制

ActionDock 使用 SQLite 内置的 `PRAGMA user_version` 管理数据库结构演进：
* 每次连接数据库时，读取当前 `user_version`。
* 若当前版本小于最新结构版本，按顺序执行增量 DDL 脚本。
* 迁移在单一事务中执行，失败自动回滚，确保本地数据文件永远不会损坏。
