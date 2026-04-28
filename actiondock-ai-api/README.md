# actiondock-ai-api

AI 领域抽象模块，只定义概念、接口和数据结构，不负责具体实现。

## 负责范围

- 模型配置 `AiModelProfile`
- Agent 配置 `AiAgentProfile`
- Toolset 配置 `AiToolset`
- Tool 描述、调用上下文和权限模型
- Chat、Structured Output、Embedding、Agent Run 的请求响应对象
- AI 调用日志、运行记录、运行步骤与仓储接口

## 核心接口

- `AiGateway`：统一的 AI 调用入口
- `AiAgentRuntime`：Agent Run 的同步/异步执行入口
- `AiToolRegistry`：平台内 AI Tool 的发现与调用入口
- `AiProviderClient`：具体 Provider 适配层接口
- `AiToolProvider`：动态提供 Tool 的扩展点

## 核心对象

- `AiModelProfile`：一个可测试、可复用的模型配置
- `AiAgentProfile`：一个可运行的 Agent 配置，关联模型和 Toolset
- `AiToolset`：按场景组织的一组工具
- `AiTool`：可被 Agent 调用的统一工具抽象
- `AiCallLog`：一次 AI 调用的日志记录
- `AiAgentRunRecord` / `AiAgentStep`：一次 Agent Run 及其步骤记录

## 设计意图

这个模块的目标是把 AI 能力从“某个 Provider SDK 的直接调用”提升为“平台级可配置、可审计、可替换的能力接口”，让上层模块只依赖统一协议。

## 相关模块

- 服务实现见 [../actiondock-ai-core/README.md](../actiondock-ai-core/README.md)
- AgentScope Provider 适配见 [../actiondock-ai-agentscope/README.md](../actiondock-ai-agentscope/README.md)
- 系统插件桥接见 [../actiondock-ai-plugin-bridge/README.md](../actiondock-ai-plugin-bridge/README.md)
