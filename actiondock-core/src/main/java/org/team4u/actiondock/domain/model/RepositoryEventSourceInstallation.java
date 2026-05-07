package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

public class RepositoryEventSourceInstallation {
    private String sourceId;
    private String repositoryId;
    private String eventSourceId;
    private String name;
    private String version;
    private String latestVersion;
    private String owner;
    private String description;
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getSourceId() {
        return sourceId;
    }

    public RepositoryEventSourceInstallation setSourceId(String sourceId) {
        this.sourceId = sourceId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public RepositoryEventSourceInstallation setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getEventSourceId() {
        return eventSourceId;
    }

    public RepositoryEventSourceInstallation setEventSourceId(String eventSourceId) {
        this.eventSourceId = eventSourceId;
        return this;
    }

    public String getName() {
        return name;
    }

    public RepositoryEventSourceInstallation setName(String name) {
        this.name = name;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public RepositoryEventSourceInstallation setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getLatestVersion() {
        return latestVersion;
    }

    public RepositoryEventSourceInstallation setLatestVersion(String latestVersion) {
        this.latestVersion = latestVersion;
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public RepositoryEventSourceInstallation setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public RepositoryEventSourceInstallation setDescription(String description) {
        this.description = description;
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public RepositoryEventSourceInstallation setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public RepositoryEventSourceInstallation setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
