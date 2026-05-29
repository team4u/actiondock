package org.team4u.actiondock.ai.api;

/**
 * AI 能力类型。
 * <p>
 * 描述 AI 模型或服务所支持的能力项，用于能力发现和模型选择。
 * 不同的 AI 提供商可能支持不同的能力组合。
 *
 * @author jay.wu
 */
public enum AiCapability {
    /** 对话能力，支持多轮文本对话 */
    CHAT,
    /** 结构化输出能力，支持按 Schema 生成结构化数据 */
    STRUCTURED_OUTPUT,
    /** 文本嵌入能力，支持将文本转换为向量表示 */
    EMBEDDING,
    /** Agent 运行能力，支持多步骤工具调用和自主决策 */
    AGENT_RUN
}
