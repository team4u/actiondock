# @actiondock/core

ActionDock 2.x Node-first 原生运行时与核心领域。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/core` 是 ActionDock 2.x 的核心领域内核与 Node-first 原生运行时。统一暴露最小化核心服务门面（`createActionDock`、`connectActionDock`）、标准服务端口体系（`DiscoveryPort`、`ExecutionPort`、`RunsPort`、`EventsPort`、`ConfigPort`、`StatePort`）、统一错误模型（`ActionDockError`）、原生平台装配（`createNodePlatform`）、服务启动（`startActionDockServer`）与包图依赖契约（`PackageGraph`），内部驱动存储引擎、受管进程与 HTTP 网络服务。

---

## 子路径导出规范

为保障边界清晰与根入口极简，`@actiondock/core` 提供精细化子路径导出：

- `.`：核心公共根入口，仅暴露 minimal 服务门面、服务端口、平台工厂与核心契约。
- `./server`：HTTP 服务容器、路由分发、TLS 安全与服务端守护进程。
- `./project`：项目元数据、清单与依赖管理、依赖闭包及原子事务。
- `./registry`：包注册表、软链接治理与包根目录寻址。
- `./profile`：远程连接配置与管理客户端。
- `./graph`：包图模型与动作目录解析。
- `./package`：包级运行时、存储驱动与参数解析工具。

---

## 统一执行主链

ActionDock 2.x 将所有调用形态（命令行、协议服务、微服务与测试沙箱）收敛至统一的确定性执行主链：

```text
Service -> Resolution -> PackageRuntime -> ExecutionService -> ActionRunner -> Action
```

- 服务接入：通过统一服务门面或标准服务端口接收外部调用请求与入参数据。
- 解析定位：通过 `resolveAction` 依赖单一事实源完成动作寻址与跨包引用消歧。
- 运行时装配：基于包图节点构建隔离的包级执行上下文与依赖环境。
- 执行协调：统筹并发配额、追踪根调用与协同取消信号。
- 动作执行：驱动单一终态状态机，执行入参出参模式校验、循环依赖拦截与状态持久化。
- 业务执行：执行开发者编写的纯粹业务逻辑并产出强类型结果。

---

## 统一服务门面与标准服务端口

### 统一服务门面

通过顶层工厂函数提供无缝屏蔽本地与远程拓扑差异的服务门面：

- 本地服务门面 `createActionDock`：创建本地 `ActionDockService` 服务端口实例，在当前 Node.js 进程内装配原生运行时驱动并高效执行。
- 远端服务门面 `connectActionDock`：创建远端 `ActionDockService` 服务端口实例，通过 HTTP 协议与远端 ActionDock 服务通信，支持鉴权令牌、请求超时控制与证书安全校验。

### 标准服务端口体系

系统将所有对外能力解耦并收敛为六大标准服务端口契约：

- 发现端口 `DiscoveryPort`：负责包与动作的元数据发现、清单检索、全文过滤与规程查询。
- 执行端口 `ExecutionPort`：负责动作的同步阻塞执行（`run`）与异步启动执行（`start`）。
- 运行端口 `RunsPort`：负责任务运行历史列表、单次详情查询与协同取消（`cancel`）。
- 事件端口 `EventsPort`：负责任务执行实时事件流订阅。
- 配置端口 `ConfigPort`：负责运行时分层配置读取、持久化配置管理与环境变量满足度体检。
- 状态端口 `StatePort`：负责包级与动作级持久化键值存取、前缀列举与过期清理。

---

## 单一事实源架构原则

ActionDock 2.x 全面贯彻单一事实源设计，彻底杜绝各模块私自实现短名搜索或启发式猜测：

- 包图发现单一事实源 `PackageDiscovery`：自顶向下扫描工作区与全局注册表，建立包目录索引。
- 包拓扑图单一事实源 `PackageGraph`：维护包节点身份标识、实例版本与拓扑依赖关系。
- 动作目录单一事实源 `ActionCatalog`：统一聚合索引所有已加载包的动作元数据，提供确定性的多维检索能力。
- 动作解析单一事实源 `resolveAction`：作为全系统动作引用的唯一解析函数。优先支持包限定斜杠语法（`<package-id>/<action-id>`）与当前调用方所属包优先匹配；严格禁止冒号历史语法（`pkg:action`）。
- 调用治理策略单一事实源 `InvocationPolicy`：统筹管理根任务最大并发配额（默认 32）、子任务并发上限（默认 64）与最大调用嵌套深度（默认 16）。

---

## 原生运行时驱动

`@actiondock/core` 深度集成 Node.js 24 原生能力，无需编译外部二进制扩展：

- 原生存储驱动 `NodeSqliteDriver`：基于 Node.js 原生 `node:sqlite`（`DatabaseSync`）构建同步存储驱动。默认启用预写日志模式（WAL）、外键约束检查与忙等待超时。
- 受管进程平台驱动 `NodeProcessDriver`：实现完整的受管进程治理体系。基于管道彻底切断子进程与宿主标准流的物理连通；支持跨平台独立进程组管理与信号派发；提供独占控制权租约、逐流增量读取与优雅终止。
- 原生网络服务容器 `NodeHttpServer`：基于 Node.js 原生 `node:http` 承载 RESTful 微服务与 Server-Sent Events 事件流。
- 原生模块加载器 `NodeModuleLoader`：基于 Node.js 原生类型擦除机制直接加载 TypeScript 源码，免除前置编译转译开销。
- 原生文件系统抽象 `NodeFileSystem`：提供跨平台文件读写与原子文件事务保障。

---

## 数据目录锁与故障自愈

通过 `DataDirLock` 在数据目录下维护 `.actiondock.data.lock` 排他文件锁，记录宿主进程与受管子进程状态：

- 活跃进程冲突防护：检测到已有活跃宿主主进程正在持有该数据目录时，抛出 `DATA_DIR_IN_USE` 错误拒绝并发启动。
- 孤儿进程保护：检测到前序宿主主进程异常退出但仍有关联受管子进程处于运行状态时，抛出 `DATA_DIR_RECOVERY_REQUIRED` 错误，阻止脏写并等待子进程回收。
- 故障自动恢复：前序宿主进程与关联子进程均已死亡时，当前宿主自动接管排他锁并安全清理残留会话。

---

## 依赖管理与原子事务

基于 `actiondock.lock.json`（规范版本 `lockfileVersion: 1`）提供严格的依赖版本锁定与原子事务保护：

- 依赖图构建：`PackageGraphBuilder` 递归解析本地包依赖与符号链接，统一建立拓扑图并检测版本冲突。
- 原子事务：`beginTransaction` 在执行依赖增删（如 `ad add` 与 `ad remove`）前为 `package.json`、`actiondock.json` 与 `actiondock.lock.json` 创建快照。若安装或校验流程失败，自动执行原子回滚并恢复原始状态。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
