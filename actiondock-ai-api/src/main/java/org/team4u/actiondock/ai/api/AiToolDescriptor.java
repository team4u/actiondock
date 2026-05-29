package org.team4u.actiondock.ai.api;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 工具描述符。
 * <p>
 * 描述一个 AI 工具的完整元数据信息，包括名称、来源、输入输出 Schema、权限级别以及可选的配置信息。
 * 用于向 AI Agent 运行时注册和展示可用工具，支持从 {@link AiTool} 实例自动提取描述符。
 *
 * @param name          工具唯一标识名称
 * @param displayName   工具展示名称
 * @param sourceType    工具来源类型（系统、脚本、Agent）
 * @param sourceId      工具来源标识，如脚本 ID
 * @param description   工具功能描述
 * @param inputSchema   输入参数 JSON Schema
 * @param outputSchema  输出结果 JSON Schema
 * @param permission    工具所需权限级别
 * @param configurable  是否支持运行时配置
 * @param configHelp    配置说明文本（仅可配置工具有效）
 * @param configExample 配置示例（仅可配置工具有效）
 * @author jay.wu
 */
public record AiToolDescriptor(
        String name,
        String displayName,
        AiToolSourceType sourceType,
        String sourceId,
        String description,
        Map<String, Object> inputSchema,
        Map<String, Object> outputSchema,
        AiToolPermission permission,
        boolean configurable,
        String configHelp,
        Map<String, Object> configExample
) {

    /**
     * 从 {@link AiTool} 实例提取工具描述符。
     * <p>
     * 自动判断工具是否为 {@link ConfigurableAiTool}，并提取配置帮助信息和示例。
     *
     * @param tool 目标工具实例，不能为 null
     * @return 工具描述符
     * @throws IllegalArgumentException 当 tool 为 null 时
     */
    public static AiToolDescriptor from(AiTool tool) {
        if (tool == null) {
            throw new IllegalArgumentException("tool 不能为空");
        }
        boolean configurable = tool instanceof ConfigurableAiTool;
        ConfigurableAiTool configurableTool = configurable ? (ConfigurableAiTool) tool : null;
        return new AiToolDescriptor(
                tool.name(),
                tool.displayName(),
                tool.sourceType(),
                tool.sourceId(),
                tool.description(),
                copy(tool.inputSchema()),
                copy(tool.outputSchema()),
                tool.permission(),
                configurable,
                configurableTool == null ? null : configurableTool.configHelp(),
                configurableTool == null ? null : copy(configurableTool.configExample())
        );
    }

    /**
     * 对 Map 进行防御性拷贝。
     *
     * @param source 原始 Map
     * @return 拷贝后的 Map，若原始为空则返回不可变空 Map
     */
    private static Map<String, Object> copy(Map<String, Object> source) {
        if (source == null || source.isEmpty()) {
            return Map.of();
        }
        return new LinkedHashMap<>(source);
    }
}
