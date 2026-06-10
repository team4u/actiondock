package org.team4u.actiondock.plugin.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public class ScriptPluginContext {
    private String scriptId;
    private String scriptName;
    private String executionId;
    private String submitMode;
    private String pluginConfigName;
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

    public String getPluginConfigName() {
        return pluginConfigName;
    }

    public ScriptPluginContext setPluginConfigName(String pluginConfigName) {
        this.pluginConfigName = pluginConfigName;
        return this;
    }

    public Map<String, Object> getScriptInput() {
        return Collections.unmodifiableMap(scriptInput);
    }

    public ScriptPluginContext setScriptInput(Map<String, Object> scriptInput) {
        this.scriptInput = scriptInput == null ? new LinkedHashMap<>() : new LinkedHashMap<>(scriptInput);
        return this;
    }

    public Map<String, Object> getPluginConfig() {
        return Collections.unmodifiableMap(pluginConfig);
    }

    /**
     * 获取最终生效的插件配置，并转换为指定的 Java 类型。
     * <p>
     * 内部委托 {@link PluginConfigBinder#bind} 进行类型转换。
     * 默认值由平台合并后注入，此方法仅负责反序列化。
     *
     * @param type 目标 Java 类型
     * @param <T>  目标类型泛型
     * @return 绑定后的配置对象实例
     */
    public <T> T getPluginConfig(Class<T> type) {
        return PluginConfigBinder.bind(pluginConfig, type);
    }

    public ScriptPluginContext setPluginConfig(Map<String, Object> pluginConfig) {
        this.pluginConfig = pluginConfig == null ? new LinkedHashMap<>() : new LinkedHashMap<>(pluginConfig);
        return this;
    }
}
