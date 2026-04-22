package org.team4u.scriptflow.plugin.api;

import java.util.LinkedHashMap;
import java.util.Map;

public class PluginActionManifest {
    private String action;
    private String title;
    private String description;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> exampleArgs = new LinkedHashMap<>();

    public String getAction() {
        return action;
    }

    public PluginActionManifest setAction(String action) {
        this.action = action;
        return this;
    }

    public String getTitle() {
        return title;
    }

    public PluginActionManifest setTitle(String title) {
        this.title = title;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginActionManifest setDescription(String description) {
        this.description = description;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public PluginActionManifest setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = inputSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(inputSchema);
        return this;
    }

    public Map<String, Object> getExampleArgs() {
        return exampleArgs;
    }

    public PluginActionManifest setExampleArgs(Map<String, Object> exampleArgs) {
        this.exampleArgs = exampleArgs == null ? new LinkedHashMap<>() : new LinkedHashMap<>(exampleArgs);
        return this;
    }
}
