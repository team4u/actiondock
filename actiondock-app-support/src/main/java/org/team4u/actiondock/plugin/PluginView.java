package org.team4u.actiondock.plugin;

import java.util.ArrayList;
import java.util.List;

/**
 * 插件视图，用于 API 响应中展示插件的概要信息。
 *
 * @author jay.wu
 */
public class PluginView {
    private String pluginId;
    private String name;
    private String description;
    private String version;
    private String repositoryId;
    private String repositoryPluginId;
    private String repositoryVersion;
    private String state;
    private PluginReferenceSourceType sourceType = PluginReferenceSourceType.INSTALLED;
    private boolean started;
    private boolean configurable;
    private String fileName;
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

    public String getRepositoryId() {
        return repositoryId;
    }

    public PluginView setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryPluginId() {
        return repositoryPluginId;
    }

    public PluginView setRepositoryPluginId(String repositoryPluginId) {
        this.repositoryPluginId = repositoryPluginId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public PluginView setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public String getState() {
        return state;
    }

    public PluginView setState(String state) {
        this.state = state;
        return this;
    }

    public PluginReferenceSourceType getSourceType() {
        return sourceType;
    }

    public PluginView setSourceType(PluginReferenceSourceType sourceType) {
        this.sourceType = sourceType == null ? PluginReferenceSourceType.INSTALLED : sourceType;
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

    public String getFileName() {
        return fileName;
    }

    public PluginView setFileName(String fileName) {
        this.fileName = fileName;
        return this;
    }
}
