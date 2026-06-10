package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI 工具注册表接口，管理可供 Agent 调用的工具集合。
 * <p>
 * 支持按工具集 ID 和 Agent 配置查询可用工具，并提供工具的查找和调用能力。
 * 工具可来源于静态注册，也可由脚本动态提供。
 *
 * @author jay.wu
 */
public interface AiToolRegistry {

    /**
     * 列出指定工具集下的所有工具。
     *
     * @param toolsetId 工具集 ID
     * @return 工具列表
     */
    List<AiTool> listTools(String toolsetId);

    /**
     * 列出指定 Agent 配置可使用的所有工具。
     *
     * @param agentProfile Agent 配置
     * @return 工具列表
     */
    List<AiTool> listAgentTools(AiAgentProfile agentProfile);

    /**
     * 根据名称获取工具。
     *
     * @param name 工具名称
     * @return 工具定义，不存在时返回 null
     */
    AiTool getTool(String name);

    /**
     * 调用指定工具并返回执行结果。
     *
     * @param toolName 工具名称
     * @param input    工具输入参数
     * @param context  工具执行上下文
     * @return 工具执行结果
     */
    AiToolExecutionResult invoke(String toolName, Map<String, Object> input, AiToolExecutionContext context);
}
