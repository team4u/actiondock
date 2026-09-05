# @actiondock/mcp

ActionDock 2.0 模型上下文协议适配器。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/mcp` 将 ActionDock 中的原子 Action 映射为标准的模型上下文协议工具，无缝接入各类主流 AI 智能体与开发环境。

---

## 核心能力

### 双协议传输通道

- **STDIO 标准输入输出通道**：专为本地客户端（如 Claude Code、Cursor、Windsurf 等开发工具）设计，直接通过子进程标准流双向通信，安全且免配置端口。
- **HTTP 传输通道**：专为远程服务与容器化部署设计，基于 Web 标准请求与响应实现流式传输，支持跨域策略配置与鉴权令牌校验。

### 工具模式自动转换

- 自动解析每个 Action 的 `inputSchema` 与 `outputSchema`，转换为标准 MCP Tool 契约。
- 智能处理多包聚合场景下的动作标识冲突，自动使用包命名空间前缀消除歧义。
- 严格遵循输入格式校验，在参数违规时向模型返回结构化诊断提示。
- 执行结果自动封装为包含文本内容块与结构化数据的 MCP 格式信封，并在异常时正确标记错误标识。

### 协同取消信号向下传播

- 当 MCP 客户端发起取消请求时，适配层自动捕获中断事件。
- 取消信号直接传递至底层的 `ActionRunner` 调度器，并联动激活当前任务上下文中的 `ctx.signal`。
- 业务代码可通过监听 `AbortSignal` 安全释放资源或提前终止执行。

### Tasks 异步任务映射扩展

针对长周期、重资源消耗的复杂任务，完整适配 MCP Tasks 异步协议扩展：

- **任务状态查询**：通过 `tasks/get` 端点根据任务标识检索当前运行状态、执行进度与部分输出快照。
- **任务主动取消**：通过 `tasks/cancel` 端点向正在后台执行的长周期任务发出中止指令。
- **任务清单列举**：通过 `tasks/list` 端点批量查询当前会话及宿主下的活跃与历史任务列表。

---

## 快速使用

通过命令行一键启动 MCP 服务：

```bash
# 以 STDIO 协议启动
ad mcp

# 以 HTTP 协议启动并在指定端口监听
ad mcp --transport http --port 8080
```

也可以在代码中通过编程方式创建适配器服务：

```ts
import { startMcpStdioServer } from "@actiondock/mcp";

await startMcpStdioServer({
  projectRoot: process.cwd(),
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
