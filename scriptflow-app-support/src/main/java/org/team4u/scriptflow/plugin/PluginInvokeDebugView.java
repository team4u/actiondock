package org.team4u.scriptflow.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

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
