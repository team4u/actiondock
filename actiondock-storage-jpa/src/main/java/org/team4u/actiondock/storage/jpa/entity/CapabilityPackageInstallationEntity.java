package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "repository_ai_package_installation")
public class CapabilityPackageInstallationEntity {
    @Id
    private String installationId;
    private String repositoryId;
    private String packageId;
    private String name;
    private String versionValue;
    private String latestVersion;
    private String entryAgentId;
    private String owner;
    @Lob
    private String description;
    @Lob
    private String modelIdsJson;
    @Lob
    private String toolsetIdsJson;
    @Lob
    private String agentIdsJson;
    @Lob
    private String scriptIdsJson;
    @Lob
    private String scheduleIdsJson;
    @Lob
    private String presetIdsJson;
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getInstallationId() {
        return installationId;
    }

    public void setInstallationId(String installationId) {
        this.installationId = installationId;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public void setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
    }

    public String getPackageId() {
        return packageId;
    }

    public void setPackageId(String packageId) {
        this.packageId = packageId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getVersionValue() {
        return versionValue;
    }

    public void setVersionValue(String versionValue) {
        this.versionValue = versionValue;
    }

    public String getLatestVersion() {
        return latestVersion;
    }

    public void setLatestVersion(String latestVersion) {
        this.latestVersion = latestVersion;
    }

    public String getEntryAgentId() {
        return entryAgentId;
    }

    public void setEntryAgentId(String entryAgentId) {
        this.entryAgentId = entryAgentId;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getModelIdsJson() {
        return modelIdsJson;
    }

    public void setModelIdsJson(String modelIdsJson) {
        this.modelIdsJson = modelIdsJson;
    }

    public String getToolsetIdsJson() {
        return toolsetIdsJson;
    }

    public void setToolsetIdsJson(String toolsetIdsJson) {
        this.toolsetIdsJson = toolsetIdsJson;
    }

    public String getAgentIdsJson() {
        return agentIdsJson;
    }

    public void setAgentIdsJson(String agentIdsJson) {
        this.agentIdsJson = agentIdsJson;
    }

    public String getScriptIdsJson() {
        return scriptIdsJson;
    }

    public void setScriptIdsJson(String scriptIdsJson) {
        this.scriptIdsJson = scriptIdsJson;
    }

    public String getScheduleIdsJson() {
        return scheduleIdsJson;
    }

    public void setScheduleIdsJson(String scheduleIdsJson) {
        this.scheduleIdsJson = scheduleIdsJson;
    }

    public String getPresetIdsJson() {
        return presetIdsJson;
    }

    public void setPresetIdsJson(String presetIdsJson) {
        this.presetIdsJson = presetIdsJson;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public void setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
