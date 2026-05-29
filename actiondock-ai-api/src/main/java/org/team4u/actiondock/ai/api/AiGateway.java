package org.team4u.actiondock.ai.api;

/**
 * AI 网关接口，提供统一的 AI 模型调用入口。
 * <p>
 * 封装了聊天对话、结构化输出和文本嵌入三种核心能力，
 * 屏蔽底层不同 AI 提供商的差异，为上层提供一致的调用体验。
 *
 * @author jay.wu
 */
public interface AiGateway {

    /**
     * 发送聊天请求并返回对话响应。
     *
     * @param request 聊天请求，包含消息列表和模型参数
     * @param context 调用上下文，包含追踪信息和配置
     * @return 聊天响应结果
     */
    AiChatResponse chat(AiChatRequest request, AiCallContext context);

    /**
     * 发送结构化输出请求，将模型响应解析为指定格式。
     *
     * @param request 结构化请求，包含消息、输出格式定义和模型参数
     * @param context 调用上下文，包含追踪信息和配置
     * @return 结构化响应结果
     */
    AiStructuredResponse structured(AiStructuredRequest request, AiCallContext context);

    /**
     * 生成文本的向量嵌入表示。
     *
     * @param request 嵌入请求，包含待嵌入的文本内容
     * @param context 调用上下文，包含追踪信息和配置
     * @return 嵌入响应结果，包含向量数据
     */
    AiEmbeddingResponse embed(AiEmbeddingRequest request, AiCallContext context);
}
