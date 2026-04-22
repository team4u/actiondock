package org.team4u.scriptflow.plugin;

import java.util.ArrayList;
import java.util.List;

public class PluginView {
    private String pluginId;
    private String name;
    private String description;
    private String version;
    private String state;
    private boolean started;
    private boolean configurable;
    private List<PluginActionView> actions = new ArrayList<>();

    public String getPluginId() {
        return pluginId;
    }

    public PluginView setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getName() {
        return name;
    }

    public PluginView setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginView setDescription(String description) {
        this.description = description;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public PluginView setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getState() {
        return state;
    }

    public PluginView setState(String state) {
        this.state = state;
        return this;
    }

    public boolean isStarted() {
        return started;
    }

    public PluginView setStarted(boolean started) {
        this.started = started;
        return this;
    }

    public boolean isConfigurable() {
        return configurable;
    }

    public PluginView setConfigurable(boolean configurable) {
        this.configurable = configurable;
        return this;
    }

    public List<PluginActionView> getActions() {
        return actions;
    }

    public PluginView setActions(List<PluginActionView> actions) {
        this.actions = actions == null ? new ArrayList<>() : new ArrayList<>(actions);
        return this;
    }
}
