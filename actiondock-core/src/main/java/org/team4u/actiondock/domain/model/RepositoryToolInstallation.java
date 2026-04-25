package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 本地已安装的仓库工具记录。
 *
 * @author jay.wu
 */
public class RepositoryToolInstallation {
    private String toolId;
    private String repositoryId;
    private String name;
    private String version;
    private String latestVersion;
    private String owner;
    private String description;
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getToolId() {
        return toolId;
    }

    public RepositoryToolInstallation setToolId(String toolId) {
        this.toolId = toolId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public RepositoryToolInstallation setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getName() {
        return name;
    }

    public RepositoryToolInstallation setName(String name) {
        this.name = name;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public RepositoryToolInstallation setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getLatestVersion() {
        return latestVersion;
    }

    public RepositoryToolInstallation setLatestVersion(String latestVersion) {
        this.latestVersion = latestVersion;
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public RepositoryToolInstallation setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public RepositoryToolInstallation setDescription(String description) {
        this.description = description;
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public RepositoryToolInstallation setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public RepositoryToolInstallation setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
