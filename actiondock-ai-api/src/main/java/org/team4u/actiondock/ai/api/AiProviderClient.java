package org.team4u.actiondock.ai.api;

/**
 * AI 提供商客户端接口，封装与具体 AI 服务商的底层通信。
 * <p>
 * 每个方法都需要传入模型配置，支持不同模型使用不同的提供商。
 * 实现（如 AgentScope）负责将请求转换为特定提供商的 API 调用格式。
 *
 * @author jay.wu
 */
public interface AiProviderClient {

    /**
     * 发送聊天请求到指定的 AI 提供商。
     *
     * @param profile 模型配置，包含提供商类型和连接参数
     * @param request 聊天请求
     * @param context 调用上下文
     * @return 聊天响应结果
     */
    AiChatResponse chat(AiModelProfile profile, AiChatRequest request, AiCallContext context);

    /**
     * 发送结构化输出请求到指定的 AI 提供商。
     *
     * @param profile 模型配置，包含提供商类型和连接参数
     * @param request 结构化请求
     * @param context 调用上下文
     * @return 结构化响应结果
     */
    AiStructuredResponse structured(AiModelProfile profile, AiStructuredRequest request, AiCallContext context);

    /**
     * 生成文本嵌入向量。
     *
     * @param profile 模型配置，包含提供商类型和连接参数
     * @param request 嵌入请求
     * @param context 调用上下文
     * @return 嵌入响应结果
     */
    AiEmbeddingResponse embed(AiModelProfile profile, AiEmbeddingRequest request, AiCallContext context);

    /**
     * 执行 Agent 运行任务，通过多轮工具调用完成目标。
     *
     * @param agentProfile Agent 配置，包含系统提示词和行为参数
     * @param modelProfile 模型配置，包含提供商类型和连接参数
     * @param request      Agent 运行请求
     * @param context      Agent 运行上下文
     * @param toolRegistry 工具注册表，提供可调用的工具集合
     * @return Agent 运行结果
     */
    AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                              AiModelProfile modelProfile,
                              AiAgentRunRequest request,
                              AiAgentRunContext context,
                              AiToolRegistry toolRegistry);

    /**
     * 执行 Agent 运行任务，支持通过观察者监听执行过程。
     * <p>
     * 默认实现忽略观察者，委托给无观察者的 {@link #runAgent} 方法。
     *
     * @param agentProfile Agent 配置
     * @param modelProfile 模型配置
     * @param request      Agent 运行请求
     * @param context      Agent 运行上下文
     * @param toolRegistry 工具注册表
     * @param observer     运行观察者，用于接收步骤执行事件
     * @return Agent 运行结果
     */
    default AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                      AiModelProfile modelProfile,
                                      AiAgentRunRequest request,
                                      AiAgentRunContext context,
                                      AiToolRegistry toolRegistry,
                                      AiAgentRunObserver observer) {
        return runAgent(agentProfile, modelProfile, request, context, toolRegistry);
    }
}
