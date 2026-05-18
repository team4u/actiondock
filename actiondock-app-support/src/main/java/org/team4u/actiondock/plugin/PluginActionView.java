package org.team4u.actiondock.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件动作视图，展示单个插件动作的元信息和输入输出模式。
 *
 * @author jay.wu
 */
public class PluginActionView {
    private String action;
    private String title;
    private String description;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> outputSchema = new LinkedHashMap<>();
    private Map<String, Object> exampleArgs = new LinkedHashMap<>();

    public String getAction() {
        return action;
    }

    public PluginActionView setAction(String action) {
        this.action = action;
        return this;
    }

    public String getTitle() {
        return title;
    }

    public PluginActionView setTitle(String title) {
        this.title = title;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginActionView setDescription(String description) {
        this.description = description;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public PluginActionView setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = inputSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(inputSchema);
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return outputSchema;
    }

    public PluginActionView setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = outputSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(outputSchema);
        return this;
    }

    public Map<String, Object> getExampleArgs() {
        return exampleArgs;
    }

    public PluginActionView setExampleArgs(Map<String, Object> exampleArgs) {
        this.exampleArgs = exampleArgs == null ? new LinkedHashMap<>() : new LinkedHashMap<>(exampleArgs);
        return this;
    }
}
