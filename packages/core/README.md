# @actiondock/core

ActionDock 2.0 核心领域模型与调度引擎。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/core` 承载 ActionDock 的领域对象、状态机、持久化接口抽象与执行服务，是与具体宿主环境解耦的通用内核。

---

## 核心领域模型

- `ProjectConfig`：定义在 `actiondock.json` 中的项目规范，包含包标识、名称、版本号、目录配置以及配置项元数据。
- `PlaybookDefinition`：智能体操作规程定义，由 Markdown 文本与其头部 YAML 元数据构成，静态记录任务步骤与调用的 Action 依赖列表。
- `ActionDockManifest`：`actiondock.manifest.json` 声明式元数据清单模型，记录每个 Action 的入口路径、功能描述、输入输出模式、静态依赖与协议注解，作为无副作用模块发现与构建规划的唯一事实源。
- `ConfigItemDefinition`：单项配置规范，涵盖默认值、类型约束、敏感脱敏标记及绑定的外部环境变量。

---

## 关键抽象接口

### SqliteDriver 驱动接口

解耦底层数据库实现，提供一致的同步参数化执行与事务契约：

- `exec(sql: string): void`：执行无返回值的 SQL 语句。
- `prepare(sql: string): SqliteStatement`：编译 SQL 模板，生成支持 `run`、`get`、`all` 方法的预编译语句对象。
- `transaction<T>(fn: () => T): T`：同步事务执行器，在出现异常时自动回滚，并在驱动层严格拦截异步 Promise 以避免事务泄漏。
- `close(): void`：释放数据库连接与文件句柄。

### ProcessExecutor 进程执行器接口

抽象跨平台的子进程操作，统一下列能力：

- `exec(command, args, options): Promise<ProcessResult>`：执行外部命令并捕获标准输出与标准错误流，支持标准输入流透传、执行超时控制、取消信号响应以及缓冲区防爆保护。
- `spawnDetached(options): Promise<DetachedProcessResult>`：独立拉起后台长周期守护进程，通过轮询就绪探针确认服务启动状态。

---

## 执行核心与状态机

### ActionRunner 执行状态机

`ActionRunner` 是单个 Action 执行的核心引擎，负责完整的生命周期状态流转与契约保障：

- **调用链环路检测**：基于调用栈跟踪，当检测到依赖循环（例如 A 动作调用 B 动作，B 动作反向调用 A 动作）时立即拦截并返回错误信封。
- **模式严格校验**：在 Action 执行前使用 Ajv 校验输入数据是否满足 `inputSchema` 契约，校验失败时直接阻断并生成结构化诊断信息。
- **运行记录持久化**：初始化运行时在 SQLite 中写入 `running` 状态记录，并在结束时流转至对应终态。
- **生命周期状态转换**：
  - 启动阶段：状态置为 `running`，绑定超时定时器与取消信号。
  - 正常完成：捕获返回值，更新状态为 `success` 并持久化输出快照。
  - 业务抛错：捕获异常，更新状态为 `failed` 并提取结构化错误码与调用栈。
  - 超时中止：超时定时器触发，发送取消信号并更新状态为 `timed_out`。
  - 主动取消：外部请求取消，更新状态为 `cancelled`。
- **上下文环境合成**：动态构建 `ActionContext`，集成配置优先级解析器、状态存储器与标准错误流日志记录器。

### DefaultExecutionService 统一执行服务

负责系统层面的并发控制、任务追踪与生命周期协同：

- **并发度控制**：维护活跃任务表，支持配置系统最大并发上限，超限时合理排队或拒接。
- **全链路追踪**：为每次执行分配全局唯一的根运行标识与父子调用关联。
- **协同取消传播**：支持根据运行标识获取执行句柄，向下游所有派生子任务广播取消信号。
- **事件汇聚分发**：将执行过程中的状态变更事件统一推送到可插拔的事件接收器中。

---

## 运行时可插拔设计

`@actiondock/core` 保持平台中立，不绑定任何特定运行环境：

- 在日常使用与 Node.js 运行时中，通过 `@actiondock/runtime-node` 注入基于 `node:sqlite` 与 `execa` 的驱动。
- 在独立二进制编译产物中，通过 `@actiondock/runtime-bun` 注入基于 `bun:sqlite` 与 `Bun.spawn` 的驱动。
- 在自动化测试中，通过 `@actiondock/testing` 注入纯内存存储驱动与模拟进程执行器。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
