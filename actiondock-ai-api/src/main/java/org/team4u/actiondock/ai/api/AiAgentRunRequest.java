package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI Agent 运行请求。
 * <p>
 * 封装发起一次 Agent 运行所需的全部参数，包含 Agent 配置、对话上下文、输入数据及可选参数。
 * Agent 会根据配置自动编排多步工具调用以完成复杂任务。
 *
 * @param agentProfile Agent 配置名称，用于路由到具体的 Agent 定义
 * @param messages     对话消息列表，按顺序组成上下文
 * @param input        运行输入数据，可供 Agent 工具使用
 * @param options      可选参数，如最大步数等 Agent 运行参数
 * @author jay.wu
 */
public record AiAgentRunRequest(
        String agentProfile,
        List<AiMessage> messages,
        Map<String, Object> input,
        Map<String, Object> options
) {
}
