# ActionDock 2.0 全景架构设计与技术规范

ActionDock 2.0 是面向 AI Agent Action 与 Skill 的现代开发、测试、构建与分发工具链。本文档全面阐述 2.0 的设计哲学、分层架构、核心领域模型、运行时管线与独立编译分发契约。

---

## 核心设计哲学

```text
                  开发态 (Authoring Phase)                              交付态 (Shipping Phase)
  ┌───────────────────────────────────────────────────────┐     ┌─────────────────────────────────────┐
  │                                                       │     │                                     │
  │   编写 Action (actions/*.ts)                           │     │    Standalone Skill Artifact        │
  │   编写 Playbook SOP (playbooks/*.md)                  │ ──► │    ├── SKILL.md (Agent 引导文档)    │
  │   配置管理 (ctx.config) & 共享状态 (ctx.state)        │     │    └── bin/<package-executable>     │
  │   本地调试与单测 (ac run / ac test)                   │     │                                     │
  │                                                       │     │    * 零依赖 (无需 Node/Bun/Python)  │
  └───────────────────────────────────────────────────────┘     └──────────────────┬──────────────────┘
                                                                                   │
                                                                                   ▼
                                                                     AI Agent / 终端使用者
                                                                     (直接调用独立二进制)
```

### 1. 零依赖交付（Zero-Install Artifacts）
在 2.0 之前，执行 Action 必须依赖中心化的服务器进程或安装特定的运行时环境。
2.0 彻底打破这一限制：通过 `Bun.build({ compile: true })` 将 Action Package 直接编译为单个自包含的静态二进制可执行文件。终端 Agent 或宿主系统**无需安装 ActionDock、Bun、Node.js、Python 或 Java**。

### 2. 无守护进程（Zero-Daemon）与 CLI 优先
ActionDock 默认不依赖任何长期运行的 Background Server 或 Web 守护进程。所有的开发、测试、构建、执行均通过命令行工具（`ac`）按需触发。在多云/远程机器场景下，通过轻量化的 `ac serve` 按需启动微型 Runner。

### 3. 文件系统优先（Filesystem First）
Action（`actions/*.ts`）、Playbook（`playbooks/*.md`）与项目元数据（`actiondock.json`）均以普通文本文件为唯一事实来源，天然享受 Git 分支管理、代码评审、历史回溯与团队协作。

### 4. 轻量嵌入式存储与无 ORM
ActionDock 使用 Bun 内置的 `bun:sqlite` 存储运行态数据（Config、State、Runs）。彻底废弃重量级 ORM 与复杂的数据库表映射，表结构严格控制在 3 张极简表内，毫秒级读写。

### 5. 独立编译契约（Standalone Contract）
ActionDock 2.0 保证**开发态执行**（`ac action run`）与**编译后独立二进制执行**（`./bin/my-pkg run`）具备 100% 的语义一致性：
* **输入与输出一致性**：均通过 JSON Schema 严格校验，stdout 均输出统一格式的标准 JSON Envelope。
* **ActionContext 语义一致性**：在独立二进制中，`ctx.config`、`ctx.state`、`ctx.actions` 与 `ctx.log` 具备完全相同的行为与优先级规则。
* **存储隔离与可配置**：独立二进制默认将数据隔离在 `~/.actiondock/data/<package-id>/runtime.db`，并支持通过参数重定向。

---

## 仓库分层架构（Clean Architecture）

代码库分为清晰的三层解耦架构，严格遵循单向依赖原则：

```text
               +--------------------------------------+
               |         Action Package (作者编写)     |
               |   import { defineAction } from SDK   |
               +------------------+-------------------+
                                  | (仅依赖极简类型与定义辅助)
                                  v
               +--------------------------------------+
               |           @actiondock/sdk            |
               |  - defineAction, ActionContext 接口   |
               |  - createTestRuntime (内存测试环境)   |
               |  - 0 外部重依赖 (纯 TS Types & Helpers) |
               +------------------+-------------------+
                                  ^
                                  | (实现接口契约)
               +------------------+-------------------+
               |           @actiondock/core           |
               |             [底层领域引擎]           |
               |  - Project (项目加载、发现与脚手架)   |
               |  - Runtime (ActionRunner 执行器)      |
               |  - Storage (SQLite: Config/State/Runs)|
               |  - Schema (Ajv JSON Schema 校验器)    |
               |  - Registry (全局开发态注册表管理)    |
               |  - Profile (多环境管理与远程 Client)  |
               |  - Server (轻量 Bun.serve HTTP 引擎)  |
               |  - Build (Bun.build 单文件编译引擎)   |
               |  - Export (Skill 导出器与打包)        |
               +------------------+-------------------+
                                  |
           +----------------------+-----------------------+
           | (门面调用)                                   | (独立编译产物打包)
           v                                              v
+--------------------+                         +--------------------+
|  @actiondock/cli   |                         | Standalone Binary  |
|    (CLI 门面层)    |                         | (独立可执行单文件) |
| - Commander 解析   |                         | - 内置 Core 运行时 |
| - 终端交互与颜色   |                         | - 零外部依赖直跑   |
+--------------------+                         +--------------------+
```

### 包职责边界与设计规范

| 包路径 | npm 包名 | 定位与核心职责 | 依赖约束 |
| :--- | :--- | :--- | :--- |
| `packages/sdk` | `@actiondock/sdk` | **极简公开契约**：提供 `defineAction`、`ActionContext`、`Config`、`StateStore`、`ActionInvoker`、`Logger` 及 `createTestRuntime`。 | **0 外部重依赖**，仅包含类型与纯内存测试工具，保障 Action 编写者的长期兼容性。 |
| `packages/core` | `@actiondock/core` | **领域内核与引擎**：承载项目解析、执行管线、SQLite 存储、Schema 校验、注册表解析、Profile 管理、HTTP Runner 引擎、单文件编译器与 Skill 导出器。 | 纯 TypeScript API，无命令行副作用，支持程序化（Programmatic）嵌入调用与测试。 |
| `packages/cli` | `@actiondock/cli` | **CLI 门面工具链**：负责命令行参数解析（Commander）、格式化终端输出与交互调度。 | 仅作为 Core 的薄封装门面。 |

---

## 核心领域模型

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              Project                                   │
│  (actiondock.json: packageId, name, version, declared configs)         │
│                                                                        │
│   ├── Actions (actions/*.ts)                                           │
│   │     └── ActionDefinition: id, description, schemas, run(input,ctx) │
│   │                                                                    │
│   ├── Playbooks (playbooks/*.md)                                       │
│   │     └── PlaybookDefinition: Frontmatter (id, actions), SOP Markdown│
│   │                                                                    │
│   └── Storage Engine (bun:sqlite)                                      │
│         ├── ConfigStore  ───► [actiondock_config]                      │
│         ├── StateStore   ───► [actiondock_state]                       │
│         └── RunRecord    ───► [actiondock_runs]                        │
└────────────────────────────────────────────────────────────────────────┘
```

| 领域模型 | 职责与事实来源 | 核心接口 / 格式 |
| :--- | :--- | :--- |
| **Project** | 项目边界元数据（`actiondock.json`），定义 packageId、名称、版本及默认配置项。 | `ProjectConfig` |
| **Action** | 最小可执行原子单元（`actions/*.ts`），包含入参/出参 JSON Schema、描述与执行逻辑。 | `ActionDefinition<I, O>` |
| **Playbook** | 面向 AI Agent 的领域任务 SOP（`playbooks/*.md`），包含关联 Action 列表与结构化操作指南。 | `PlaybookDefinition` |
| **Config** | 运行时配置参数，统一遵循三级解析优先级（CLI 覆盖 > 本地 SQLite > 项目默认声明）。 | `RuntimeConfig` |
| **Shared State** | 跨执行持久化的 Key-Value 状态存储，支持命名空间隔离。 | `RuntimeStateStore` |
| **Run Record** | Action 单次执行追踪记录，包含 runId、入参、出参、耗时、状态及调用堆栈。 | `RunRecord` |
| **Registry** | 全局开发态注册表（`~/.actiondock/registry.json`），支持 `ac link` 跨目录源码调用。 | `GlobalRegistryData` |
| **Profile** | 多环境与云机器调度配置（`~/.actiondock/profiles.json`），实现跨云透明转发。 | `ProfilesConfig` |
| **Artifact** | 编译后的独立二进制产物与元数据描述清单（`artifact.json`）。 | `ArtifactManifest` |

---

## Action 执行管线与运行时架构

每次执行 Action 时，ActionRunner 均会严格经过以下标准化生命周期：

```text
 传入 input, configOverrides
            │
            ▼
 1. 循环调用检测 (Cycle Detection) ───[检测到递归成环]───► 抛出 ACTION_CYCLE_DETECTED
            │ (通过)
            ▼
 2. 入参 Schema 校验 (Ajv Validator) ─[校验失败]────────► 抛出 INPUT_VALIDATION_FAILED
            │ (通过)
            ▼
 3. 创建初始 RunRecord (status: running)
            │
            ▼
 4. 构建 ActionContext 注入对象
    ├── ctx.config   (优先级: CLI overrides > SQLite > actiondock.json)
    ├── ctx.state    (SQLite 命名空间隔离状态)
    ├── ctx.actions  (支持嵌套调用其他 Action: ctx.actions.invoke)
    └── ctx.log      (stderr 流式日志输出)
            │
            ▼
 5. 执行 action.run(input, ctx)
            │
      ┌─────┴─────┐
   (成功)       (失败/异常)
      │           │
      ▼           ▼
 6. 出参校验   7. 捕获错误堆栈
      │           │
      ▼           ▼
 8. 更新 RunRecord (status: success / failed)
      │
      ▼
 9. 输出标准 JSON Envelope 到 stdout:
    { "ok": true, "runId": "...", "data": { ... } }
```

### 标准 JSON Envelope 契约
所有的 Action 执行结果严格输出至 `stdout`，保持机器可解析性：

```json
// 成功响应
{
  "ok": true,
  "runId": "01918a20-7f2e-7d63-b184-47ef00112233",
  "data": {
    "result": "processed"
  }
}

// 失败响应
{
  "ok": false,
  "runId": "01918a20-7f2e-7d63-b184-47ef00112233",
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Input schema validation failed for action 'order.create'",
    "details": [...]
  }
}
```

---

## 多环境与云机器调度架构 (Profile & Remote Runner)

ActionDock 2.0 通过 **Profile 抽象** 与 **轻量 HTTP Runner 引擎（`Bun.serve`）** 实现了无缝的跨机器调度：

```text
       本地开发机 / AI Agent                           远端云主机 (阿里云 / AWS / 等)
  ┌───────────────────────────────┐                  ┌───────────────────────────────┐
  │                               │                  │                               │
  │  ac run server.check-disk     │  HTTP POST /run  │  ac serve --port 5177         │
  │    --profile aliyun-prod      │ ───────────────► │    ├── 极轻量 Bun 原生 HTTP   │
  │                               │ (Bearer Token)   │    ├── 读取本地已注册 Action  │
  │                               │                  │    └── 执行并返回标准结果     │
  │  stdout: 标准 JSON 结果       │ ◄─────────────── │                               │
  │  { "ok": true, "data": ... }  │  JSON Envelope   │                               │
  └───────────────────────────────┘                  └───────────────────────────────┘
```

### 调度目标优先级解析链
$$\text{CLI 参数 (--server/--token)} > \text{CLI 参数 (--profile)} > \text{环境变量 (ACTIONDOCK\_*)} > \text{当前默认 profile} > \text{本地直接执行}$$

无论是在本地执行还是转发至远端云节点执行，终端 Agent 接收到的 stdout JSON Envelope 均完全一致。

---

## 存储架构与 SQLite 表结构设计

ActionDock 使用轻量嵌入式 `bun:sqlite` 实现运行态数据的无状态持久化，无任何外部数据库服务依赖。

```sql
-- 1. 运行时持久化配置表
CREATE TABLE IF NOT EXISTS actiondock_config (
  package_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, key)
);

-- 2. 跨执行持久化状态表 (支持命名空间)
CREATE TABLE IF NOT EXISTS actiondock_state (
  package_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, namespace, key)
);

-- 3. 执行历史追踪表
CREATE TABLE IF NOT EXISTS actiondock_runs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

### 存储路径解析规则
1. **项目本地开发态**：优先保存在项目根目录下的 `.actiondock/data.db`（便于项目内开发调试与清理）。
2. **全局或跨包执行**：保存在用户主目录 `~/.actiondock/data/<package-id>/runtime.db`。
3. **环境重定向**：可通过 `ACTIONDOCK_HOME` 环境变量自定义运行时基础目录。

---

## 独立编译与 Skill 导出机制

```text
               Project Source
         (actions/*.ts, playbooks/*.md)
                       │
                       ▼
            Code Generation Engine
        (生成 static-registry.ts 启动桩)
                       │
                       ▼
             Bun.build({ compile })
        (嵌入 Bun 引擎与所有依赖代码)
                       │
                       ▼
             Standalone Executable
         (单文件独立二进制，无外部运行时依赖)
                       │
                       ▼
               Skill Export Engine
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
    SKILL.md                    artifact.json
 (Agent 指南与元数据)          (构建与版本清单)
```

1. **静态加载器代码生成**：构建器自动扫描项目中的全部 Action，生成一个静态引用表（Static Registry），彻底消除动态反射或动态 `import()` 的运行时依赖。
2. **单文件二进制打包**：利用 Bun 编译引擎，将静态加载器、TypeScript 源码、依赖包及 `@actiondock/core` 运行时引擎打包为一个可直接执行的单文件二进制（支持目标平台交叉编译：`linux-x64`、`darwin-arm64`、`windows-x64` 等）。
3. **Skill 交付包组装**：导出包含 `SKILL.md`、Playbook SOP 文档及二进制文件的完整 Skill 目录或 `.zip` 压缩包，任何主流 AI Agent 框架均可开箱即用。
