package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 脚本声明的插件依赖。
 *
 * @author jay.wu
 */
public class PluginDependency {
    private String pluginId;
    private String versionRange;
    private List<String> requiredActions = new ArrayList<>();

    public String getPluginId() {
        return pluginId;
    }

    public PluginDependency setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getVersionRange() {
        return versionRange;
    }

    public PluginDependency setVersionRange(String versionRange) {
        this.versionRange = versionRange;
        return this;
    }

    public List<String> getRequiredActions() {
        return List.copyOf(requiredActions);
    }

    public PluginDependency setRequiredActions(List<String> requiredActions) {
        this.requiredActions = requiredActions == null ? new ArrayList<>() : new ArrayList<>(requiredActions);
        return this;
    }
}
