# @actiondock/runtime-node

ActionDock 2.0 原生 Node.js 运行时适配器包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/runtime-node` 为 ActionDock 核心内核提供基于 Node.js 22+ 与 Node.js 24 LTS 原生特性的运行时驱动实现。

---

## 核心适配组件

### NodeSqliteDriver

基于 Node.js 内置模块 `node:sqlite` 的 `DatabaseSync` 实现：

- 完整实现 `@actiondock/core` 定义的 `SqliteDriver` 接口。
- 支持单值、展开参数与数组形式的位置参数化绑定查询，防御 SQL 注入。
- 提供同步事务处理，在回调函数抛出异常时自动回滚。
- 事务执行过程中严格拦截并拒绝异步 Promise，防止底层锁泄漏。

### ExecaProcessExecutor

基于 `execa` 封装的统一进程执行器：

- 完整实现 `@actiondock/core` 定义的 `ProcessExecutor` 接口。
- 支持指定工作目录、环境变量合并以及向子进程标准输入流写入数据。
- 完整支持执行超时定时器与基于 `AbortSignal` 的外部信号取消。
- 内置标准输出缓冲区阈值保护，超过指定字节数时安全截断并强行终止子进程，防止内存溢出。
- 支持启动后台守护进程，解耦标准输入输出并基于就绪探针函数轮询运行状态。

### TsxModuleLoader

基于 `tsx` 的 TypeScript 动态模块加载器：

- 原生支持按需加载未编译的 TypeScript 模块（`.ts`、`.tsx`、`.mts`）。
- 自动解析相对路径、候选文件扩展名与目录索引入口。
- 智能提取模块导出，自动解包 CommonJS 与 ES Module 混合规范下的默认导出。

### NodeHttpServer

基于 Node.js 原生 `node:http` 模块实现的 HTTP 微服务容器：

- 双向转换标准 Web Request 与 Web Response 流式传输。
- 挂载路由请求处理回调，为 CLI 的 `ad serve` 与 HTTP 模式的 MCP 传输通道提供网络层支持。
- 提供端口占用自动释放与优雅停机接口。

---

## 环境初始化

在应用入口调用 `setupNodeRuntime`，即可将上述所有驱动注入为 Core 层的全局实现：

```ts
import { setupNodeRuntime } from "@actiondock/runtime-node";

// 注册 NodeSqliteDriver、ExecaProcessExecutor 与 NodeHttpServer 为 Core 默认实现
setupNodeRuntime();
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
