package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * Built-in system plugin enablement state.
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
