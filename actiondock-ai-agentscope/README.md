# actiondock-ai-agentscope

基于 AgentScope 的 AI Provider 实现模块，把 `actiondock-ai-api` 的统一接口接到具体模型和 Agent 执行框架上。

## 负责范围

- `AiProviderClient` 的 AgentScope 实现
- Chat、Structured Output、Embedding、Agent Run 的实际调用
- Tool Descriptor 到 AgentScope Toolkit 的转换
- 内置工具与权限边界的桥接

## 支持的方向

- OpenAI
- DashScope
- Ollama
- Gemini
- Anthropic

具体能否使用，取决于平台中配置的 `AiModelProfile` 与 Provider 参数。

## 模块价值

- 把上层统一抽象落到真实推理框架
- 复用 AgentScope 的 ReAct Agent、Toolkit 和模型适配
- 为后续替换或新增 Provider 实现预留边界

## 相关模块

- 抽象协议见 [../actiondock-ai-api/README.md](../actiondock-ai-api/README.md)
- 业务编排见 [../actiondock-ai-core/README.md](../actiondock-ai-core/README.md)
- Groovy / Python 脚本侧调用见 [../actiondock-ai-plugin-bridge/README.md](../actiondock-ai-plugin-bridge/README.md)
