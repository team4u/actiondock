package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 本地已安装的能力包记录。
 */
public class CapabilityPackageInstallation {
    private String installationId;
    private String repositoryId;
    private String packageId;
    private String name;
    private String version;
    private String latestVersion;
    private String entryAgentId;
    private String owner;
    private String description;
    private List<String> modelIds = new ArrayList<>();
    private List<String> toolsetIds = new ArrayList<>();
    private List<String> agentIds = new ArrayList<>();
    private List<String> scriptIds = new ArrayList<>();
    private List<String> scheduleIds = new ArrayList<>();
    private List<String> presetIds = new ArrayList<>();
    private List<String> playbookGroupIds = new ArrayList<>();
    private List<String> playbookIds = new ArrayList<>();
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getInstallationId() {
        return installationId;
    }

    public CapabilityPackageInstallation setInstallationId(String installationId) {
        this.installationId = installationId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public CapabilityPackageInstallation setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getPackageId() {
        return packageId;
    }

    public CapabilityPackageInstallation setPackageId(String packageId) {
        this.packageId = packageId;
        return this;
    }

    public String getName() {
        return name;
    }

    public CapabilityPackageInstallation setName(String name) {
        this.name = name;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public CapabilityPackageInstallation setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getLatestVersion() {
        return latestVersion;
    }

    public CapabilityPackageInstallation setLatestVersion(String latestVersion) {
        this.latestVersion = latestVersion;
        return this;
    }

    public String getEntryAgentId() {
        return entryAgentId;
    }

    public CapabilityPackageInstallation setEntryAgentId(String entryAgentId) {
        this.entryAgentId = entryAgentId;
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public CapabilityPackageInstallation setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public CapabilityPackageInstallation setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getModelIds() {
        return List.copyOf(modelIds);
    }

    public CapabilityPackageInstallation setModelIds(List<String> modelIds) {
        this.modelIds = modelIds == null ? new ArrayList<>() : new ArrayList<>(modelIds);
        return this;
    }

    public List<String> getToolsetIds() {
        return List.copyOf(toolsetIds);
    }

    public CapabilityPackageInstallation setToolsetIds(List<String> toolsetIds) {
        this.toolsetIds = toolsetIds == null ? new ArrayList<>() : new ArrayList<>(toolsetIds);
        return this;
    }

    public List<String> getAgentIds() {
        return List.copyOf(agentIds);
    }

    public CapabilityPackageInstallation setAgentIds(List<String> agentIds) {
        this.agentIds = agentIds == null ? new ArrayList<>() : new ArrayList<>(agentIds);
        return this;
    }

    public List<String> getScriptIds() {
        return List.copyOf(scriptIds);
    }

    public CapabilityPackageInstallation setScriptIds(List<String> scriptIds) {
        this.scriptIds = scriptIds == null ? new ArrayList<>() : new ArrayList<>(scriptIds);
        return this;
    }

    public List<String> getScheduleIds() {
        return List.copyOf(scheduleIds);
    }

    public CapabilityPackageInstallation setScheduleIds(List<String> scheduleIds) {
        this.scheduleIds = scheduleIds == null ? new ArrayList<>() : new ArrayList<>(scheduleIds);
        return this;
    }

    public List<String> getPresetIds() {
        return List.copyOf(presetIds);
    }

    public CapabilityPackageInstallation setPresetIds(List<String> presetIds) {
        this.presetIds = presetIds == null ? new ArrayList<>() : new ArrayList<>(presetIds);
        return this;
    }

    public List<String> getPlaybookGroupIds() {
        return List.copyOf(playbookGroupIds);
    }

    public CapabilityPackageInstallation setPlaybookGroupIds(List<String> playbookGroupIds) {
        this.playbookGroupIds = playbookGroupIds == null ? new ArrayList<>() : new ArrayList<>(playbookGroupIds);
        return this;
    }

    public List<String> getPlaybookIds() {
        return List.copyOf(playbookIds);
    }

    public CapabilityPackageInstallation setPlaybookIds(List<String> playbookIds) {
        this.playbookIds = playbookIds == null ? new ArrayList<>() : new ArrayList<>(playbookIds);
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public CapabilityPackageInstallation setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public CapabilityPackageInstallation setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
