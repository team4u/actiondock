package org.team4u.actiondock.domain.model;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 本地受管 Skill 安装记录。
 */
public class SkillInstallation {
    private String installationId;
    private String skillId;
    private String repositoryId;
    private String version;
    private String targetId;
    private String targetPath;
    private String installedPath;
    private String digest;
    private String displayName;
    private String description;
    private boolean enabled;
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getInstallationId() {
        return installationId;
    }

    public SkillInstallation setInstallationId(String installationId) {
        this.installationId = installationId;
        return this;
    }

    public String getSkillId() {
        return skillId;
    }

    public SkillInstallation setSkillId(String skillId) {
        this.skillId = skillId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public SkillInstallation setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public SkillInstallation setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getTargetId() {
        return targetId;
    }

    public SkillInstallation setTargetId(String targetId) {
        this.targetId = targetId;
        return this;
    }

    public String getTargetPath() {
        return targetPath;
    }

    public SkillInstallation setTargetPath(String targetPath) {
        this.targetPath = targetPath;
        return this;
    }

    public String getInstalledPath() {
        return installedPath;
    }

    public SkillInstallation setInstalledPath(String installedPath) {
        this.installedPath = installedPath;
        return this;
    }

    public String getDigest() {
        return digest;
    }

    public SkillInstallation setDigest(String digest) {
        this.digest = digest;
        return this;
    }

    public String getDisplayName() {
        return displayName;
    }

    public SkillInstallation setDisplayName(String displayName) {
        this.displayName = displayName;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public SkillInstallation setDescription(String description) {
        this.description = description;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public SkillInstallation setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public SkillInstallation setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public SkillInstallation setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public static SkillInstallation fromManagedSkillAndTarget(ManagedSkill skill,
                                                               SkillTarget target,
                                                               Path installedPath,
                                                               SkillInstallation existing,
                                                               String installationId,
                                                               LocalDateTime now) {
        return new SkillInstallation()
                .setInstallationId(installationId)
                .setSkillId(skill.getSkillId())
                .setRepositoryId(skill.getRepositoryId())
                .setVersion(skill.getVersion())
                .setTargetId(target.getId())
                .setTargetPath(target.getRootPath())
                .setInstalledPath(installedPath.toString())
                .setDigest(skill.getDigest())
                .setDisplayName(skill.getDisplayName())
                .setDescription(skill.getDescription())
                .setEnabled(true)
                .setInstalledAt(existing == null ? now : Optional.ofNullable(existing.getInstalledAt()).orElse(now))
                .setUpdatedAt(now);
    }

    public SkillInstallation copy() {
        return new SkillInstallation()
                .setInstallationId(installationId)
                .setSkillId(skillId)
                .setRepositoryId(repositoryId)
                .setVersion(version)
                .setTargetId(targetId)
                .setTargetPath(targetPath)
                .setInstalledPath(installedPath)
                .setDigest(digest)
                .setDisplayName(displayName)
                .setDescription(description)
                .setEnabled(enabled)
                .setInstalledAt(installedAt)
                .setUpdatedAt(updatedAt);
    }
}
