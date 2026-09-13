# @actiondock/runtime-node

ActionDock 2.0 原生 Node.js 运行时适配器包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/runtime-node` 为 ActionDock 核心内核提供基于 Node.js >=24.12.0 原生特性的运行时驱动实现，包含非阻塞工作线程存储驱动、原生进程调度、原生类型擦除源码加载与流式网络服务。

---

## 核心适配组件

### WorkerSqliteDriver 非阻塞工作线程存储驱动

[WorkerSqliteDriver](./src/worker-sqlite-driver.ts) 基于 Node.js worker_threads 模块构建：

- 工作线程隔离：将 SQLite 同步存储操作隔离在独立工作线程中运行，彻底避免密集数据读写与复杂事务阻塞主事件循环。
- 独立异步驱动：作为独立异步驱动提供，不注入 core 的同步存储契约；平台默认使用同步的 NodeSqliteDriver（`useWorker` 选项仅为兼容保留，传入时会回落同步驱动并告警）。
- 完整事务支持：完整支持参数化查询与语句清单式事务原子提交，并在异常时自动回滚；函数式事务回调内不允许读操作，违例会收到明确报错。
- 故障自愈处理：当工作线程异常退出时，未决请求报错并由宿主安全捕获。

### NodeSqliteDriver 同步数据库驱动

[NodeSqliteDriver](./src/sqlite-driver.ts) 基于 Node.js 内置模块 `node:sqlite` 的 DatabaseSync 实现：

- 完整实现核心层定义的 SqliteDriver 接口。
- 支持单值、展开参数与数组形式的位置参数化绑定查询，防御 SQL 注入。
- 提供同步事务处理，在回调函数抛出异常时自动回滚。
- 事务执行过程中严格拦截并拒绝异步 Promise，防止底层锁泄漏。

### NodeProcessDriver 受管进程平台驱动

[NodeProcessDriver](./src/process-driver.ts) 完整实现 Core 层的 ProcessDriver 契约，为受管进程提供企业级操作系统驱动：

- pipe 管道模式：基于 `node:child_process` 派生，在派生完成前即刻挂载流监听器，彻底避免竞态导致的头部输出丢失。
- PTY 伪终端模式：动态按需探测 `node-pty` 支持，提供真实的虚拟终端仿真与终端窗口尺寸动态调整；在缺失 PTY 支持的环境下明确报告能力不支持。
- 严格环境变量沙箱：通过核心层统一定义的环境变量解析逻辑，支持严格白名单继承与无继承隔离，按需叠加显式新增与剔除列表。
- 跨平台进程树隔离：使用独立进程组派生，并在终止时通过 `killProcessGroup` 跨平台递归清理子进程树，杜绝孤儿进程逃逸。
- 写入流控与输入净终止：标准输入写入具备背压感知，支持调用 `inputEOF` 干净终止标准输入流通道。
- 优雅输出排空：主进程退出后提供默认 5 秒输出排空宽限期，避免后续子进程尾部数据读取截断，排空结束精准触发 `outputClosed` 状态闭环。

### NodeProcessExecutor 与 ExecaProcessExecutor 兼容进程执行器

统一进程执行器基于 Node.js 原生能力与 [ExecaProcessExecutor](./src/process-executor.ts) 实现：

- 完整实现核心层定义的 ProcessExecutor 兼容接口。
- 支持指定工作目录、环境变量合并以及向子进程标准输入流写入数据。
- 完整支持执行超时控制与基于 AbortSignal 的外部信号取消，并采用进程树终止策略杜绝孤儿进程。
- 内置标准输出缓冲区阈值保护，超过指定字节数时安全截断并强行终止子进程，防止内存溢出。

### NodeModuleLoader 原生类型擦除源码加载器

[NodeModuleLoader](./src/module-loader.ts) 充分利用 Node.js 24 原生类型擦除特性：

- 原生加载 TypeScript：依托 Node.js 24 原生类型擦除与 ESM 动态加载，无需额外编译步骤即可直接导入 `.ts` 与 `.mts` 源码。
- 严格扩展名规范：严格要求显式入口扩展名，彻底拒绝无扩展名隐式补全与 CommonJS 目录索引解析。
- 智能导出解包：智能识别并解包框架约定的默认导出对象与处理函数。

### NodeHttpServer 流式网络服务容器

[NodeHttpServer](./src/http-server.ts) 基于 Node.js 原生 `node:http` 模块实现：

- 双向转换标准 Web Request 与 Web Response 流式传输。
- 挂载路由请求处理回调，为 CLI 的 `ad serve` 与 HTTP 模式的 MCP 传输通道提供网络层支持。
- 提供端口占用自动检测、释放与优雅停机支持。

---

## 平台组装与初始化

通过 [createNodePlatform](./src/platform.ts) 平台工厂函数，一键组装全套 Node.js 原生运行时实例：

```ts
import { createNodePlatform } from "@actiondock/runtime-node";

// 创建组装好的 Node 运行时平台实例（默认使用同步 NodeSqliteDriver）
const platform = createNodePlatform({
  dataDir: "./.actiondock/data",
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
