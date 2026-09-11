# @actiondock/core

ActionDock 2.0 核心领域模型与调度引擎。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/core` 承载 ActionDock 的领域对象、状态机、数据目录排他锁、统一调用门面、依赖事务管理与执行服务，是与具体宿主环境解耦的通用内核。

---

## 统一调用门面与异常

### ActionDockTarget 统一调用门面

[ActionDockTarget](./src/target/types.ts) 为命令行工具、上层服务与应用集成屏蔽本地执行、远程服务与跨进程通信的物理拓扑差异：

- 本地门面 LocalTarget：直接调用本地加载的 ActionDockApp 或 ActionDockHost 实例，在同进程内高效执行。
- 远程门面 RemoteTarget：通过 HTTP 协议与远程 ActionDock 服务通信，支持鉴权令牌与请求超时控制。
- 跨进程门面 IpcTarget：通过 Node.js 进程间通信通道与子进程交互，包含诊断流速率保护与反压控制。

### TargetError 结构化异常

[TargetError](./src/target/types.ts) 继承标准 Error，提供机器可读的结构化错误码与附加详情：

- `TARGET_PROTOCOL_UNSUPPORTED`：协议版本或特性不受支持。
- `TARGET_CAPABILITY_UNAVAILABLE`：目标端未启用或缺失所需能力。
- `TARGET_RESULT_UNKNOWN`：连接超时或中断导致执行结果状态未知。

---

## 数据目录锁与故障恢复

[DataDirLock](./src/storage/data-dir-lock.ts) 在数据目录下维护 `.actiondock.data.lock` 排他文件锁，记录宿主主进程与受管子进程状态，防止多实例并发冲突：

- `DATA_DIR_IN_USE`：检测到已有活跃宿主主进程正在持有该数据目录，拒绝并发启动。
- `DATA_DIR_RECOVERY_REQUIRED`：检测到前序宿主主进程异常退出，但仍有关联受管子进程处于运行状态，触发故障恢复拦截。
- 正常退出时自动释放并移除锁文件；非正常退出且无任何残留进程时允许安全接管。

---

## 依赖管理与锁定规范

基于 `actiondock.lock.json`（规范版本 `lockfileVersion: 1`）提供严格的依赖版本锁定与原子事务保护：

- 依赖解析：[ActionPackageResolver](./src/project/resolver.ts) 递归解析本地包依赖与符号链接，避免重复加载。
- 原子事务：[beginTransaction](./src/project/transactions.ts) 在执行依赖增删（如 `ad add` 与 `ad remove`）前为 `package.json`、`actiondock.json` 与 `actiondock.lock.json` 创建磁盘快照。若安装或校验流程失败，自动执行原子回滚并恢复原始状态。

---

## 核心领域模型

- ProjectConfig：定义在 `actiondock.json` 中的项目规范，包含包标识、名称、版本号、目录配置以及配置项元数据。
- PlaybookDefinition：智能体操作规程定义，由 Markdown 文本与其头部 YAML 元数据构成，静态记录任务步骤与调用的 Action 依赖列表。
- ConfigItemDefinition：单项配置规范，涵盖默认值、类型约束、敏感脱敏标记及绑定的外部环境变量。

---

## 关键抽象契约

### SqliteDriver 驱动接口

解耦底层数据库实现，提供一致的参数化执行与事务契约：

- `exec(sql: string): void`：执行无返回值的 SQL 语句。
- `prepare(sql: string): SqliteStatement`：编译 SQL 模板，生成预编译语句对象。
- `transaction<T>(fn: () => T): T`：同步事务执行器，在出现异常时自动回滚，并在驱动层严格拦截异步 Promise 以避免事务泄漏。
- `close(): void`：释放数据库连接与文件句柄。

### ProcessExecutor 进程执行器接口

抽象跨平台的子进程操作：

- `exec(command, args, options): Promise<ProcessResult>`：执行外部命令并捕获标准输出与标准错误流，支持标准输入流透传、执行超时控制、取消信号响应以及缓冲区防爆保护。

---

## 执行核心与状态机

### ActionRunner 执行状态机

[ActionRunner](./src/execution/runner.ts) 是单个 Action 执行的核心引擎，负责完整的生命周期状态流转与契约保障：

- 调用链环路检测：基于调用栈跟踪，当检测到依赖循环调用时立即拦截并返回错误信封。
- 模式严格校验：在 Action 执行前校验输入数据是否满足模式规范，校验失败时直接阻断并生成结构化诊断信息。
- 运行记录持久化：在 SQLite 中写入 `running` 状态记录，并在结束时流转至对应终态。
- 生命周期状态转换：涵盖 `running`、`success`、`failed`、`timed_out`、`cancelled`、`interrupted` 状态。
- 上下文环境合成：动态构建 ActionContext，集成配置优先级解析器、状态存储器与标准错误流日志记录器。

### DefaultExecutionService 统一执行服务

[DefaultExecutionService](./src/execution/service.ts) 负责系统层面的并发控制、任务追踪与生命周期协同：

- 并发度控制：维护活跃任务表，支持配置系统最大并发上限，超限时排队或拒绝。
- 全链路追踪：为每次执行分配全局唯一的根运行标识与父子调用关联。
- 协同取消传播：支持根据运行标识获取执行句柄，向下游所有派生子任务广播取消信号。
- 事件汇聚分发：将执行过程中的状态变更事件统一推送到事件接收器中。

---

## 运行时可插拔设计

`@actiondock/core` 保持平台中立，不绑定任何特定运行环境：

- 在日常生产与 Node.js 运行时中，通过 [@actiondock/runtime-node](../runtime-node/README.md) 注入默认同步存储驱动与 Node.js 进程执行器（另有独立异步驱动 WorkerSqliteDriver 可选）。
- 在自动化测试中，通过 [@actiondock/testing](../testing/README.md) 注入纯内存存储驱动 MemoryStorage 与模拟进程执行器 MockProcessExecutor。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
