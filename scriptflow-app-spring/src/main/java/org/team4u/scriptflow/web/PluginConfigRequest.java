package org.team4u.scriptflow.web;

import java.util.LinkedHashMap;
import java.util.Map;

public class PluginConfigRequest {
    private Map<String, Object> config = new LinkedHashMap<>();

    public Map<String, Object> getConfig() {
        return config;
    }

    public void setConfig(Map<String, Object> config) {
        this.config = config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
    }
}
