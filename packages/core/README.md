# @actiondock/core

ActionDock 2.x Node-first 原生运行时与核心领域。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/core` 是 ActionDock 2.x 核心领域内核与 Node-first 原生运行时。
模块暴露核心服务门面（`createActionDock`、`connectActionDock`）与标准服务端口（`DiscoveryPort`、`ExecutionPort`、`RunsPort`、`EventsPort`、`ConfigPort`、`StatePort`）。
模块提供统一错误模型 `ActionDockError`、平台装配 `createNodePlatform`、服务启动 `startActionDockServer` 与包图契约 `PackageGraph`。
底层驱动存储引擎、受管进程与 HTTP 网络服务。

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

顶层工厂函数屏蔽本地与远程拓扑差异，提供统一服务门面：

- 本地服务门面 `createActionDock`：创建本地 `ActionDockService` 服务端口实例，在当前 Node.js 进程内装配原生运行时驱动并高效执行。
- 远端服务门面 `connectActionDock`：创建远端 `ActionDockService` 服务端口实例。实例通过 HTTP 与远端通信，支持鉴权令牌、超时控制与证书安全校验。

### 标准服务端口体系

系统将所有对外能力解耦并收敛为六大标准服务端口契约：

- 发现端口 `DiscoveryPort`：负责包与动作的元数据发现、清单检索、全文过滤与规程查询。
- 执行端口 `ExecutionPort`：负责动作的同步阻塞执行（`run`）与异步启动执行（`start`）。
- 任务端口 `RunsPort`：负责任务执行历史列表（含请求标识反查）与单次详情查询。支持读取取消信号（`signal`）、协同取消（`cancel`）以及按策略清理历史记录（`clearRuns`、`cleanExpiredRuns`）。
- 事件端口 `EventsPort`：负责任务执行实时事件流订阅。
- 配置端口 `ConfigPort`：负责运行时分层配置读取、持久化配置管理与环境变量满足度体检。
- 状态端口 `StatePort`：负责包级与动作级持久化键值存取、前缀列举与过期清理。

---

## 单一事实源架构原则

ActionDock 2.x 全面贯彻单一事实源设计，彻底杜绝各模块私自实现短名搜索或启发式猜测：

- 包图发现单一事实源 `PackageDiscovery`：自顶向下扫描工作区与全局注册表，创建包目录索引。
- 包拓扑图单一事实源 `PackageGraph`：维护包节点身份标识、实例版本与拓扑依赖关系。
- 动作目录单一事实源 `ActionCatalog`：统一聚合索引所有已加载包的动作元数据，提供确定性的多维检索能力。
- 动作解析单一事实源 `resolveAction`：全系统动作引用的唯一解析函数。系统支持包限定斜杠语法（`<package-id>/<action-id>`）并优先匹配调用方所属包。严格禁止冒号历史语法（`pkg:action`）。
- 调用治理策略单一事实源 `InvocationPolicy`：统筹管理并发配额与调用深度。根任务并发上限默认 32，子任务并发上限默认 64，最大嵌套深度默认 16。

---

## 原生运行时驱动

`@actiondock/core` 深度集成 Node.js 24 原生能力，无需编译外部二进制扩展：

- 原生存储驱动 `NodeSqliteDriver`：基于 Node.js 原生 `node:sqlite`（`DatabaseSync`）构建同步存储驱动。默认启用预写日志模式（WAL）、外键约束校验与忙等待超时。
- 受管进程平台驱动 `NodeProcessDriver`：实现受管进程治理体系。驱动基于管道切断子进程与宿主标准流的连通。驱动支持跨平台独立进程组管理与信号派发。系统提供独占控制权租约、逐流增量读取与优雅终止。
- 原生网络服务容器 `NodeHttpServer`：基于 Node.js 原生 `node:http` 承载 RESTful 微服务与 Server-Sent Events 事件流。
- 原生模块加载器 `NodeModuleLoader`：基于 Node.js 原生类型擦除机制直接加载 TypeScript 源码，免除前置编译转译开销。

---

## 微服务启动与访问控制

通过 `startActionDockServer` 启动 Node.js 原生 HTTP/HTTPS 微服务，提供标准 RESTful API 与统一内嵌 `/mcp` 端点：

- 服务配置参数（`ServerOptions`）：
  - `port`：监听端口（默认 5177）。
  - `host`：监听地址（默认 127.0.0.1，监听非回环地址时强制要求配置 token）。
  - `token`：服务访问鉴权令牌。
  - `packageAllowlist`：允许访问执行的包标识白名单列表（为空允许全部）。
  - `actionAllowlist`：允许访问执行的动作标识白名单列表（为空允许全部，支持短名 actionId 与全限定名 packageId/actionId）。
  - `tls`：HTTPS 证书与私钥配置。
  - `corsOrigins`：允许的跨域来源白名单。
- 权限交集与安全拦截：
  - 同时配置 `packageAllowlist` 与 `actionAllowlist` 时取两者交集。
  - 服务端拦截未授权动作的详情调阅与执行请求，返回 HTTP 403 状态码与 `ACTION_FORBIDDEN` 结构化错误。
  - 历史执行记录查询、单次详情与取消操作同步实施白名单校验。
  - 统一内嵌的 MCP 协议端点工具注册与任务扩展同样受白名单联动过滤。

---

## 数据目录锁与自动恢复

通过 `DataDirLock` 在数据目录下维护 `.actiondock.data.lock` 排他文件锁，记录宿主进程与受管子进程状态：

- 活跃进程冲突防护：检测到已有活跃宿主主进程持有该数据目录时，抛出 `DATA_DIR_IN_USE` 错误拒绝并发启动。
- 孤儿进程保护：检测到前序宿主进程非正常退出且受管子进程仍处于执行状态时，抛出 `DATA_DIR_RECOVERY_REQUIRED` 错误。系统阻止脏写并等待子进程回收。
- 锁自动恢复：前序宿主进程与子进程均已退出时，当前宿主接管排他锁并安全清理残留会话。

---

## 依赖管理与原子事务

基于 `actiondock.lock.json`（规范版本 `lockfileVersion: 1`）提供严格的依赖版本锁定与原子事务保护：

- 依赖图构建：`PackageGraphBuilder` 递归解析本地包依赖与符号链接，统一构建拓扑图并检测版本冲突。
- 原子事务：`beginTransaction` 在执行依赖增删（如 `ad add` 与 `ad remove`）前为 `package.json`、`actiondock.json` 与 `actiondock.lock.json` 创建快照。若安装或校验流程失败，自动执行原子回滚并恢复原始状态。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
