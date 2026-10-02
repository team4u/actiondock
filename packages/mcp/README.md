# @actiondock/mcp

ActionDock 2.x 模型上下文协议适配器。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/mcp` 将 ActionDock 中的原子 Action 映射为标准的模型上下文协议工具，无缝接入各类主流智能体与宿主环境。MCP 适配层直接对接 `@actiondock/core` 导出的标准服务端口体系，忠实保持工具模式与业务入参契约。

---

## 核心能力

### 双协议传输通道

- STDIO 标准输入输出通道：专为本地客户端设计，直接通过子进程标准流双向通信，具备受控诊断流隔离与进程退出协同机制。
- HTTP 传输通道：专为远程服务与容器化部署设计，基于 Web 标准请求与响应实现流式传输，支持跨域策略配置与鉴权令牌校验。

### 纯净模式映射与契约忠实

- 原始模式完全保真：工具入参和出参模式完全忠实于 Action 定义，不在模式中注入非业务执行包装字段。
- 业务入参纯净传递：工具入参直接透明传递至底层执行引擎，不修改或过滤业务自有的入参字段。
- 命名空间冲突隔离：智能处理多包聚合场景下的动作标识冲突，自动使用包命名空间前缀消除歧义。
- 结构化结果转换：执行结果自动封装为包含文本内容块与结构化数据的 MCP 标准信封。

### 规程映射为资源与提示词

- 只读资源映射：将 Playbook 操作规程自动注册为只读 MCP Resource，支持客户端直接读取 Markdown 规程文本。
- 提示词模版映射：将 Playbook 映射为 MCP Prompt，方便智能体快速装配规程指令。

### 协同取消信号向下传播

- 当 MCP 客户端发起取消请求时，适配层自动捕获中断事件。
- 取消信号通过服务端口直接传递至底层的执行服务，并联动激活当前任务上下文中的 `ctx.signal`。
- 业务代码可通过监听 AbortSignal 安全释放资源或提前终止执行。

### 细粒度权限白名单与安全过滤

MCP 适配层原生支持基于包与动作维度的双层白名单控制，通过 `ActionDockMcpOptions` 进行配置：

- 包白名单 `packageAllowlist`（别名 `packageIds`）：限制仅暴露指定包内的工具与规程。
- 动作白名单 `actionAllowlist`：限制仅暴露指定的动作，支持动作短名 `actionId` 与全限定名 `packageId/actionId`。
- 联动过滤机制：同时配置包白名单与动作白名单时自动计算权限交集，未获授权的动作不会出现在 `tools/list` 工具列表中。

---

## 快速使用

通过命令行启动 MCP 服务：

```bash
# 以 STDIO 协议启动
ad mcp

# 以 HTTP 协议启动并在指定端口监听
ad mcp serve --port 8080
```

在代码中通过编程方式创建适配器服务：

```ts
import { startMcpStdio } from "@actiondock/mcp";

await startMcpStdio({
  projectRoot: process.cwd(),
  packageAllowlist: ["system-tools"],
  actionAllowlist: ["system-tools/status", "ping"],
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
