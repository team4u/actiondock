package org.team4u.actiondock.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件调用调试视图，记录调用时的原始参数和脚本输入。
 *
 * @author jay.wu
 */
public class PluginInvokeDebugView {
    private Map<String, Object> args = new LinkedHashMap<>();
    private Map<String, Object> scriptInput = new LinkedHashMap<>();

    public Map<String, Object> getArgs() {
        return args;
    }

    public PluginInvokeDebugView setArgs(Map<String, Object> args) {
        this.args = args == null ? new LinkedHashMap<>() : new LinkedHashMap<>(args);
        return this;
    }

    public Map<String, Object> getScriptInput() {
        return scriptInput;
    }

    public PluginInvokeDebugView setScriptInput(Map<String, Object> scriptInput) {
        this.scriptInput = scriptInput == null ? new LinkedHashMap<>() : new LinkedHashMap<>(scriptInput);
        return this;
    }
}
