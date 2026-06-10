package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * 可配置的 AI 工具接口。
 * <p>
 * 扩展 {@link AiTool} 接口，为工具提供运行时配置能力。
 * 实现此接口的工具可以被用户通过配置选项定制行为，
 * 同时需提供配置说明和示例以辅助用户使用。
 *
 * @author jay.wu
 */
public interface ConfigurableAiTool extends AiTool {

    /**
     * 根据配置选项创建配置后的工具实例。
     *
     * @param options 配置选项键值对
     * @return 配置后的工具实例
     */
    AiTool configure(Map<String, Object> options);

    /**
     * 返回配置说明文本，帮助用户理解可配置项。
     *
     * @return 配置说明，默认返回 null
     */
    default String configHelp() {
        return null;
    }

    /**
     * 返回配置示例，展示典型的配置结构。
     *
     * @return 配置示例键值对，默认返回空 Map
     */
    default Map<String, Object> configExample() {
        return Map.of();
    }
}
