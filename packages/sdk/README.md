# @actiondock/sdk

ActionDock 2.0 纯净核心开发者接口契约包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/sdk` 为开发者编写原子 Action 提供零外部依赖的纯净类型定义与核心契约。

---

## 安装方式

使用标准包管理器添加依赖：

```bash
npm install @actiondock/sdk
```

---

## 核心契约与函数

### defineAction 函数

用于声明并严格校验单个 Action 的静态属性与执行函数：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "calculator.add",
  description: "计算两个数值之和",

  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number", description: "第一个加数" },
      b: { type: "number", description: "第二个加数" },
    },
    required: ["a", "b"],
  },

  outputSchema: {
    type: "object",
    properties: {
      result: { type: "number", description: "计算结果" },
    },
    required: ["result"],
  },

  async run(input, ctx) {
    ctx.log.info(`计算加法: ${input.a} + ${input.b}`);
    return {
      result: input.a + input.b,
    };
  },
});
```

`defineAction` 支持的完整契约字段：

- `id`：动作唯一标识符，格式通常为领域或命名空间前缀拼接名称。
- `description`：动作功能的人类可读说明。
- `inputSchema`：入参模式规范，采用标准 JSON Schema 格式。
- `outputSchema`：出参模式规范，采用标准 JSON Schema 格式。
- `uses`：静态声明当前 Action 所依赖的其他 Action 标识列表。
- `tags`：用于分类与检索的标签数组。
- `annotations`：面向协议适配器的扩展注解字典。
- `run`：业务执行入口函数，接收已通过校验的入参数据和运行时上下文对象。

---

## ActionContext 运行时上下文

在 Action 执行时，宿主环境注入标准化上下文对象 `ActionContext`，提供受控的系统交互能力：

- `ctx.process`：进程执行接口，提供 `exec` 与 `spawnDetached`，安全调用系统外部命令或启动后台守护进程，支持超时与输出截断保护。
- `ctx.log`：结构化日志输出接口，提供 `debug`、`info`、`warn`、`error` 级别日志。日志严格输出至标准错误流，彻底隔离标准输出流，杜绝污染协议报文。
- `ctx.progress`：进度报告器，支持在长时间运行的任务中通过 `report(current, total, message)` 上报当前阶段。
- `ctx.signal`：协作式取消信号，类型为标准 `AbortSignal`。当任务被外部客户端取消或超时时自动触发中止，业务逻辑需主动监听并响应。
- `ctx.run`：当前执行实例元数据，包含 `id`（本次运行标识）、`rootId`（根调用标识）和 `parentId`（父级调用标识），便于全链路追踪。
- `ctx.config`：分层配置读取接口，提供 `get` 与 `has` 方法，支持优先级回退与类型强转。
- `ctx.state`：持久化状态接口，提供基于当前 Package 命名空间隔离的键值存储与存活时间控制。
- `ctx.actions`：动作相互调用接口，支持调用包内其他 Action，并内置调用栈环路死锁检测。

---

## 外部命令行执行工具

SDK 内置防死锁的命令行工具函数：

- `execCli`：安全执行外部命令行工具，处理跨平台可执行后缀解析与标准输入流写入，严格受超时控制。
- `spawnDetached`：脱离当前父进程拉起后台进程，解耦标准输入输出并轮询就绪探针，防止管道未闭合导致挂起。

---

## 快速单元测试

结合 `@actiondock/testing` 或 SDK 内置的测试辅助方法，可以在纯内存环境下毫秒级验证 Action：

```ts
import { createTestRuntime } from "@actiondock/sdk";
import addAction from "../actions/add";

const runtime = createTestRuntime();
const result = await runtime.run(addAction, { a: 10, b: 20 });
console.log(result.result); // 输出 30
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
