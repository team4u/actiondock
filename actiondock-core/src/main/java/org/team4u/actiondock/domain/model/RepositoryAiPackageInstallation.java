package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 本地已安装的 AI 能力包记录。
 */
public class RepositoryAiPackageInstallation {
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
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getInstallationId() {
        return installationId;
    }

    public RepositoryAiPackageInstallation setInstallationId(String installationId) {
        this.installationId = installationId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public RepositoryAiPackageInstallation setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getPackageId() {
        return packageId;
    }

    public RepositoryAiPackageInstallation setPackageId(String packageId) {
        this.packageId = packageId;
        return this;
    }

    public String getName() {
        return name;
    }

    public RepositoryAiPackageInstallation setName(String name) {
        this.name = name;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public RepositoryAiPackageInstallation setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getLatestVersion() {
        return latestVersion;
    }

    public RepositoryAiPackageInstallation setLatestVersion(String latestVersion) {
        this.latestVersion = latestVersion;
        return this;
    }

    public String getEntryAgentId() {
        return entryAgentId;
    }

    public RepositoryAiPackageInstallation setEntryAgentId(String entryAgentId) {
        this.entryAgentId = entryAgentId;
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public RepositoryAiPackageInstallation setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public RepositoryAiPackageInstallation setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getModelIds() {
        return List.copyOf(modelIds);
    }

    public RepositoryAiPackageInstallation setModelIds(List<String> modelIds) {
        this.modelIds = modelIds == null ? new ArrayList<>() : new ArrayList<>(modelIds);
        return this;
    }

    public List<String> getToolsetIds() {
        return List.copyOf(toolsetIds);
    }

    public RepositoryAiPackageInstallation setToolsetIds(List<String> toolsetIds) {
        this.toolsetIds = toolsetIds == null ? new ArrayList<>() : new ArrayList<>(toolsetIds);
        return this;
    }

    public List<String> getAgentIds() {
        return List.copyOf(agentIds);
    }

    public RepositoryAiPackageInstallation setAgentIds(List<String> agentIds) {
        this.agentIds = agentIds == null ? new ArrayList<>() : new ArrayList<>(agentIds);
        return this;
    }

    public List<String> getScriptIds() {
        return List.copyOf(scriptIds);
    }

    public RepositoryAiPackageInstallation setScriptIds(List<String> scriptIds) {
        this.scriptIds = scriptIds == null ? new ArrayList<>() : new ArrayList<>(scriptIds);
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public RepositoryAiPackageInstallation setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public RepositoryAiPackageInstallation setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
