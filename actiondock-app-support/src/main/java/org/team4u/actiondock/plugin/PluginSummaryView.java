package org.team4u.actiondock.plugin;

/**
 * Lightweight plugin summary for list responses.
 */
public class PluginSummaryView {
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
    private int actionCount;

    public String getPluginId() {
        return pluginId;
    }

    public PluginSummaryView setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getName() {
        return name;
    }

    public PluginSummaryView setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginSummaryView setDescription(String description) {
        this.description = description;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public PluginSummaryView setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public PluginSummaryView setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryPluginId() {
        return repositoryPluginId;
    }

    public PluginSummaryView setRepositoryPluginId(String repositoryPluginId) {
        this.repositoryPluginId = repositoryPluginId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public PluginSummaryView setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public String getState() {
        return state;
    }

    public PluginSummaryView setState(String state) {
        this.state = state;
        return this;
    }

    public PluginReferenceSourceType getSourceType() {
        return sourceType;
    }

    public PluginSummaryView setSourceType(PluginReferenceSourceType sourceType) {
        this.sourceType = sourceType == null ? PluginReferenceSourceType.INSTALLED : sourceType;
        return this;
    }

    public boolean isStarted() {
        return started;
    }

    public PluginSummaryView setStarted(boolean started) {
        this.started = started;
        return this;
    }

    public boolean isConfigurable() {
        return configurable;
    }

    public PluginSummaryView setConfigurable(boolean configurable) {
        this.configurable = configurable;
        return this;
    }

    public String getFileName() {
        return fileName;
    }

    public PluginSummaryView setFileName(String fileName) {
        this.fileName = fileName;
        return this;
    }

    public int getActionCount() {
        return actionCount;
    }

    public PluginSummaryView setActionCount(int actionCount) {
        this.actionCount = Math.max(actionCount, 0);
        return this;
    }
}
