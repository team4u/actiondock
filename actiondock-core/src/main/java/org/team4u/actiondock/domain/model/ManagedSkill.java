package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * Skill 主体记录。一个 skillId 仅保留一份受管副本。
 */
public class ManagedSkill {
    private String skillId;
    private String repositoryId;
    private String version;
    private String digest;
    private String displayName;
    private String description;
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getSkillId() {
        return skillId;
    }

    public ManagedSkill setSkillId(String skillId) {
        this.skillId = skillId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ManagedSkill setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public ManagedSkill setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getDigest() {
        return digest;
    }

    public ManagedSkill setDigest(String digest) {
        this.digest = digest;
        return this;
    }

    public String getDisplayName() {
        return displayName;
    }

    public ManagedSkill setDisplayName(String displayName) {
        this.displayName = displayName;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public ManagedSkill setDescription(String description) {
        this.description = description;
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public ManagedSkill setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ManagedSkill setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public static ManagedSkill create(String skillId, String repositoryId,
                                      String version, String digest,
                                      String displayName, String description,
                                      ManagedSkill existing, LocalDateTime now) {
        return new ManagedSkill()
                .setSkillId(skillId)
                .setRepositoryId(repositoryId)
                .setVersion(version)
                .setDigest(digest)
                .setDisplayName(displayName)
                .setDescription(description)
                .setInstalledAt(existing == null ? now : existing.getInstalledAt() != null ? existing.getInstalledAt() : now)
                .setUpdatedAt(now);
    }

    public ManagedSkill copyWith(String version, String digest, LocalDateTime updatedAt) {
        return new ManagedSkill()
                .setSkillId(skillId)
                .setRepositoryId(repositoryId)
                .setVersion(version)
                .setDigest(digest)
                .setDisplayName(displayName)
                .setDescription(description)
                .setInstalledAt(installedAt)
                .setUpdatedAt(updatedAt);
    }
}
