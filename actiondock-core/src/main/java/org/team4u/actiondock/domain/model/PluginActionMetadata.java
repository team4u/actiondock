package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件动作元数据，描述插件提供的单个动作。
 * <p>
 * 包含动作的标识、标题、描述、输入模式以及示例参数。
 * 用于在界面上展示动作信息并引导用户正确使用。
 *
 * @author jay.wu
 */
public class PluginActionMetadata {
    private String action;
    private String title;
    private String description;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> outputSchema = new LinkedHashMap<>();
    private Map<String, Object> exampleArgs = new LinkedHashMap<>();
    private Map<String, Object> aiHints = new LinkedHashMap<>();

    public String getAction() {
        return action;
    }

    public PluginActionMetadata setAction(String action) {
        this.action = action;
        return this;
    }

    /**
     * 获取动作的显示标题。
     *
     * @return 动作标题
     */
    public String getTitle() {
        return title;
    }

    public PluginActionMetadata setTitle(String title) {
        this.title = title;
        return this;
    }

    /**
     * 获取动作的详细描述。
     *
     * @return 动作描述
     */
    public String getDescription() {
        return description;
    }

    public PluginActionMetadata setDescription(String description) {
        this.description = description;
        return this;
    }

    /**
     * 获取动作的输入参数模式。
     * <p>
     * 定义调用此动作所需的参数及其类型约束。
     *
     * @return 输入模式映射
     */
    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public PluginActionMetadata setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = inputSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(inputSchema);
        return this;
    }

    /**
     * 获取动作的输出结果模式。
     * <p>
     * 定义插件动作返回结果的字段结构，用于在界面上直观展示返回值约定。
     *
     * @return 输出模式映射
     */
    public Map<String, Object> getOutputSchema() {
        return outputSchema;
    }

    public PluginActionMetadata setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = outputSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(outputSchema);
        return this;
    }

    /**
     * 获取示例参数。
     * <p>
     * 提供调用此动作的典型参数示例，用于帮助用户理解如何使用。
     *
     * @return 示例参数映射
     */
    public Map<String, Object> getExampleArgs() {
        return exampleArgs;
    }

    public PluginActionMetadata setExampleArgs(Map<String, Object> exampleArgs) {
        this.exampleArgs = exampleArgs == null ? new LinkedHashMap<>() : new LinkedHashMap<>(exampleArgs);
        return this;
    }

    public Map<String, Object> getAiHints() {
        return aiHints;
    }

    public PluginActionMetadata setAiHints(Map<String, Object> aiHints) {
        this.aiHints = aiHints == null ? new LinkedHashMap<>() : new LinkedHashMap<>(aiHints);
        return this;
    }
}
