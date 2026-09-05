# @actiondock/runtime-bun

ActionDock 2.0 原生 Bun 运行时适配器包。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/runtime-bun` 为 ActionDock 提供基于 Bun 原生特性的运行时驱动适配层，专门用于装配和构建零外部依赖的单文件独立二进制产物。

---

## 定位与用途

在日常开发与工具调用中，开发者与智能体使用标准 Node.js 环境。

`@actiondock/runtime-bun` 的核心定位是为编译管线提供支撑：

- 当执行 `ad build` 时，构建系统将整个 Action Package 源码、依赖闭包连同 `@actiondock/runtime-bun` 静态编译为单个自包含可执行文件。
- 编译生成的产物在目标主机上无需安装 Node.js，也无需安装 Bun，由内嵌的 Bun 引擎直接驱动本包内的原生适配器运行。

---

## 核心适配组件

### BunSqliteDriver

基于 `bun:sqlite` 模块的 `Database` 实现：

- 完整实现 `@actiondock/core` 定义的 `SqliteDriver` 接口。
- 支持展开参数与数组形式的位置参数化查询。
- 依托 Bun 原生 SQLite 事务能力，支持自动提交与异常安全回滚。
- 拦截并拒绝异步 Promise 事务操作。

### BunProcessExecutor

基于 `Bun.spawn` 封装的统一进程执行器：

- 完整实现 `@actiondock/core` 定义的 `ProcessExecutor` 接口。
- 支持参数数组、工作目录、环境变量合并以及向标准输入写入字节或字符串。
- 响应超时定时器与 `AbortSignal` 取消信号，及时终止底层进程。
- 内置标准输出缓冲区阈值保护，超出配额后强行退出并截断输出。
- 支持通过 `spawnDetached` 脱离父进程启动后台服务，结合就绪探针轮询检测。

### BunHttpServer

基于 `Bun.serve` 实现的高性能 HTTP 微服务容器：

- 原生处理标准 Web Request 与 Web Response 对象。
- 为独立二进制产物中的 `ad serve` 与 HTTP 传输模式提供微秒级网络响应。
- 支持动态更新请求处理器与优雅关闭活动连接。

---

## 环境初始化

在独立二进制产物的启动入口中，通过 `setupBunRuntime` 将 Bun 驱动注入为 Core 层的默认实现：

```ts
import { setupBunRuntime } from "@actiondock/runtime-bun";

// 注册 BunSqliteDriver、BunProcessExecutor 与 BunHttpServer 为 Core 默认实现
setupBunRuntime();
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
