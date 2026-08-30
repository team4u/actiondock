# 架构总览与核心设计

ActionDock 2.0 是面向 AI Agent Action 与 Skill 的现代开发、测试、构建与分发工具链。本文档详细介绍 2.0 的核心设计哲学、分层架构、核心领域模型以及独立编译契约。

---

## 核心设计理念

### 零安装交付（Zero-Install Artifacts）
在 2.0 之前，执行 Action 必须依赖中心化的服务器进程或安装特定的运行时环境。
2.0 彻底打破这一限制：通过 `Bun.build({ compile: true })` 将 Action Package 直接编译为单个自包含的静态二进制可执行文件。终端 Agent 或用户机器上**无需安装 ActionDock、Bun、Node.js、Python 或 Java**。

### 无守护进程（Zero-Daemon）与 CLI 优先
ActionDock 不再维护长期运行的 Background Server 或 Web Server 守护进程。所有的开发、测试、构建、执行均通过命令行工具（`ac`）按需触发。

### 文件系统优先（Filesystem First）
Action（`actions/*.ts`）、Playbook（`playbooks/*.md`）与项目定义（`actiondock.json`）均以普通文本文件为唯一事实来源，天然享受 Git 分支管理、代码评审、历史回溯与团队协作。

### 轻量持久化与无 ORM
ActionDock 仅使用 `bun:sqlite` 存储运行态数据（Config、State、Runs）。彻底废弃重量级 ORM 与复杂的数据库表映射，表结构严格控制在 3 张轻量表。

---

## 仓库分层架构（Clean Architecture）

代码库分为清晰的三层解耦架构：

```text
               +--------------------------------------+
               |         Action Package (作者编写)     |
               |   import { defineAction } from SDK   |
               +------------------+-------------------+
                                  | (仅依赖极简类型与定义辅助)
                                  v
               +--------------------------------------+
               |           @actiondock/sdk            |
               |  - defineAction, ActionContext 类型   |
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
               |  - Build (Bun.build 单文件编译引擎)   |
               |  - Export (Skill 导出器与打包)        |
               |  - StandaloneRuntime (编译产物运行时) |
               +------------------+-------------------+
                                  |
          +-----------------------+-----------------------+
          | (门面调用)                                     | (未来门面调用)
          v                                               v
+------------------+                            +------------------+
| @actiondock/cli  |                            |  未来 Web UI /   |
|   (CLI 门面层)   |                            | Desktop / Host   |
| - Commander 解析 |                            | - 浏览器可视界面 |
| - 终端输出与高亮 |                            | - 本地 DevTools  |
+------------------+                            +------------------+
```

### 包职责说明
* **`@actiondock/sdk`**：面向 Action 编写者。零重依赖，仅包含类型定义与内存测试运行时。保证 Action 编写者即使长期不升级 CLI 也不会受到框架耦合影响。
* **`@actiondock/core`**：核心领域引擎。承载项目解析、执行管线、存储驱动、Schema 校验、构建器与导出器。所有 API 均为纯 TypeScript 函数，脱离任何命令行解析。
* **`@actiondock/cli` (`ac`)**：命令行门面。负责参数解析、终端交互并调用 `@actiondock/core`。

---

## 核心领域模型

| 领域模型 | 职责与事实来源 |
| :--- | :--- |
| **Project** | 项目边界元数据（`actiondock.json`），包含 packageId、名称、版本、依赖及默认配置声明。 |
| **Action** | 可执行原子单元（`actions/*.ts`），声明全局唯一 ID、描述、inputSchema、outputSchema 及 `run` 方法。 |
| **Playbook** | 面向 AI Agent 的领域任务 SOP（`playbooks/*.md`），包含 YAML Frontmatter 与 Markdown 操作步骤。 |
| **Config** | 运行时配置参数，支持三级优先级解析（命令行参数覆盖 > 本地 SQLite > 项目默认值）。 |
| **Shared State** | 跨执行持久化的 Key-Value 状态存储，物理隔离在 SQLite 中，支持命名空间。 |
| **Run** | Action 单次执行记录，包含 runId、输入、输出、错误、起止时间及父子关联（parentRunId）。 |
| **Build** | 将项目所有 Action 静态打包并编译为自包含二进制的构建流程。 |
| **Artifact** | 编译后交付物，包含独立二进制与构建元数据（`artifact.json`）。 |

---

## 独立编译契约（Standalone Contract）

ActionDock 2.0 保证**开发态执行**（`ac action run`）与**编译后独立二进制执行**（`./bin/my-pkg run`）具备 100% 的语义一致性：

* **输入与输出一致性**：均通过 JSON Schema 严格校验，stdout 均输出统一格式的标准 JSON Envelope。
* **ActionContext 语义一致性**：在独立二进制中，`ctx.config`、`ctx.state`、`ctx.actions` 与 `ctx.log` 具备完全相同的行为与优先级规则。
* **存储隔离与可配置**：独立二进制默认将数据隔离在 `~/.actiondock/data/<package-id>/runtime.db`，并支持通过全局参数 `--data-dir <path>` 重定向。
