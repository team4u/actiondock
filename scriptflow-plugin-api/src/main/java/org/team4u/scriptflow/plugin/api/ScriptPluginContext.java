package org.team4u.scriptflow.plugin.api;

import java.util.LinkedHashMap;
import java.util.Map;

public class ScriptPluginContext {
    private String scriptId;
    private String scriptName;
    private String executionId;
    private String submitMode;
    private Map<String, Object> scriptInput = new LinkedHashMap<>();
    private Map<String, Object> pluginConfig = new LinkedHashMap<>();

    public String getScriptId() {
        return scriptId;
    }

    public ScriptPluginContext setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getScriptName() {
        return scriptName;
    }

    public ScriptPluginContext setScriptName(String scriptName) {
        this.scriptName = scriptName;
        return this;
    }

    public String getExecutionId() {
        return executionId;
    }

    public ScriptPluginContext setExecutionId(String executionId) {
        this.executionId = executionId;
        return this;
    }

    public String getSubmitMode() {
        return submitMode;
    }

    public ScriptPluginContext setSubmitMode(String submitMode) {
        this.submitMode = submitMode;
        return this;
    }

    public Map<String, Object> getScriptInput() {
        return scriptInput;
    }

    public ScriptPluginContext setScriptInput(Map<String, Object> scriptInput) {
        this.scriptInput = scriptInput == null ? new LinkedHashMap<>() : new LinkedHashMap<>(scriptInput);
        return this;
    }

    public Map<String, Object> getPluginConfig() {
        return pluginConfig;
    }

    public ScriptPluginContext setPluginConfig(Map<String, Object> pluginConfig) {
        this.pluginConfig = pluginConfig == null ? new LinkedHashMap<>() : new LinkedHashMap<>(pluginConfig);
        return this;
    }
}
