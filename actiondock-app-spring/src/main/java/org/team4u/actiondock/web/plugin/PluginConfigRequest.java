package org.team4u.actiondock.web.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件配置更新请求。
 *
 * @author jay.wu
 */
public class PluginConfigRequest {
    private Map<String, Object> config = new LinkedHashMap<>();

    public Map<String, Object> getConfig() {
        return config;
    }

    public void setConfig(Map<String, Object> config) {
        this.config = config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
    }
}
