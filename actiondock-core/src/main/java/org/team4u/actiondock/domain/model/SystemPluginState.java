package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 内置系统插件的启用状态。
 * <p>
 * 记录系统级别插件的启用/禁用状态，支持运行时动态切换。
 *
 * @author jay.wu
 */
public class SystemPluginState {
    private String pluginId;
    private boolean enabled;
    private LocalDateTime updatedAt;

    public String getPluginId() {
        return pluginId;
    }

    public SystemPluginState setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public SystemPluginState setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public SystemPluginState setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public SystemPluginState copy() {
        return new SystemPluginState()
                .setPluginId(pluginId)
                .setEnabled(enabled)
                .setUpdatedAt(updatedAt);
    }
}
