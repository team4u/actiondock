# actiondock-ai-core

AI 领域服务模块，基于 `actiondock-ai-api` 的抽象实现模型、Agent、Toolset 和运行时编排逻辑。

## 主要服务

- `AiModelProfileService`：模型配置的增删改查与引用校验
- `AiAgentProfileService`：Agent 配置管理与依赖校验
- `AiToolsetService`：Toolset 管理
- `AiToolRegistryImpl`：聚合平台内可暴露工具
- `AiGatewayImpl`：统一分发 Chat、Structured Output、Embedding 请求
- `AiAgentRuntimeImpl`：执行同步/异步 Agent Run，并维护运行记录

## 模块职责

- 校验模型、Agent、Toolset 的依赖关系
- 统一 AI 调用入口，屏蔽底层 Provider 差异
- 管理 Agent Run 生命周期、步骤记录、恢复与取消
- 组织平台工具为 Agent 可消费的 Tool Descriptor

## 运行流

1. 上层提交 `AiChatRequest`、`AiStructuredRequest` 或 `AiAgentRunRequest`
2. `AiGatewayImpl` 或 `AiAgentRuntimeImpl` 根据配置选择具体 Provider Client
3. Tool Registry 提供当前可用工具描述和执行能力
4. 运行结果、调用日志和步骤记录写入对应仓储

## 相关模块

- 抽象协议见 [../actiondock-ai-api/README.md](../actiondock-ai-api/README.md)
- Provider 适配见 [../actiondock-ai-agentscope/README.md](../actiondock-ai-agentscope/README.md)
- Web 入口见 [../actiondock-app-spring/README.md](../actiondock-app-spring/README.md)
