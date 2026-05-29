package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 工具接口。
 * <p>
 * 定义 Agent 可调用的工具契约，包括工具的名称、描述、输入输出 Schema、
 * 权限等级以及执行方法。工具是 Agent 与外部系统交互的核心抽象，
 * 通过工具注册表被发现和调度。
 *
 * @author jay.wu
 */
public interface AiTool {
    /**
     * 获取工具的唯一名称。
     *
     * @return 工具名称
     */
    String name();

    /**
     * 获取工具的功能描述，供模型理解工具用途。
     *
     * @return 工具描述
     */
    String description();

    /**
     * 获取工具的来源类型。
     * <p>
     * 默认为系统内置工具。
     *
     * @return 工具来源类型
     */
    default AiToolSourceType sourceType() {
        return AiToolSourceType.SYSTEM;
    }

    /**
     * 获取工具的来源标识。
     * <p>
     * 默认与工具名称相同。
     *
     * @return 来源标识
     */
    default String sourceId() {
        return name();
    }

    /**
     * 获取工具的显示名称。
     * <p>
     * 默认与工具名称相同，可用于界面展示。
     *
     * @return 显示名称
     */
    default String displayName() {
        return name();
    }

    /**
     * 获取工具的输入参数 Schema。
     *
     * @return 输入 Schema，遵循 JSON Schema 规范
     */
    Map<String, Object> inputSchema();

    /**
     * 获取工具的输出结果 Schema。
     *
     * @return 输出 Schema，遵循 JSON Schema 规范
     */
    Map<String, Object> outputSchema();

    /**
     * 获取工具的权限等级。
     *
     * @return 工具权限
     */
    AiToolPermission permission();

    /**
     * 执行工具调用。
     *
     * @param input   工具输入参数
     * @param context 工具执行上下文
     * @return 工具执行结果
     */
    AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context);
}
