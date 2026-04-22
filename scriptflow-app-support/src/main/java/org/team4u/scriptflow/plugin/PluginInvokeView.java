package org.team4u.scriptflow.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

public class PluginInvokeView {
    private String pluginId;
    private String action;
    private Map<String, Object> result = new LinkedHashMap<>();
    private PluginInvokeDebugView debug;

    public String getPluginId() {
        return pluginId;
    }

    public PluginInvokeView setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getAction() {
        return action;
    }

    public PluginInvokeView setAction(String action) {
        this.action = action;
        return this;
    }

    public Map<String, Object> getResult() {
        return result;
    }

    public PluginInvokeView setResult(Map<String, Object> result) {
        this.result = result == null ? new LinkedHashMap<>() : new LinkedHashMap<>(result);
        return this;
    }

    public PluginInvokeDebugView getDebug() {
        return debug;
    }

    public PluginInvokeView setDebug(PluginInvokeDebugView debug) {
        this.debug = debug;
        return this;
    }
}
