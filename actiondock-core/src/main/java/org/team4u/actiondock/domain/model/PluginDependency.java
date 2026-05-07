package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

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

    public PluginDependency copy() {
        return new PluginDependency()
                .setPluginId(pluginId)
                .setVersionRange(versionRange)
                .setRequiredActions(requiredActions);
    }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof PluginDependency other)) {
            return false;
        }
        return Objects.equals(pluginId, other.pluginId)
                && Objects.equals(versionRange, other.versionRange)
                && Objects.equals(requiredActions, other.requiredActions);
    }

    @Override
    public int hashCode() {
        return Objects.hash(pluginId, versionRange, requiredActions);
    }
}
