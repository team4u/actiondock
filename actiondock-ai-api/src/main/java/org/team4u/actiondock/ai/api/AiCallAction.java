package org.team4u.actiondock.ai.api;

/**
 * AI 调用动作类型。
 * <p>
 * 定义 AI 网关支持的三种核心调用动作：对话、结构化输出和文本嵌入，
 * 用于在路由请求时区分不同的调用模式。
 *
 * @author jay.wu
 */
public enum AiCallAction {
    /** 对话调用，返回自由格式的文本响应 */
    CHAT,
    /** 结构化输出调用，返回符合指定 Schema 的结构化数据 */
    STRUCTURED,
    /** 文本嵌入调用，返回输入文本的向量表示 */
    EMBED
}
