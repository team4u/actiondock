package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 本地 Skill 安装目标。
 */
public class SkillTarget {
    private String id;
    private String name;
    private String type;
    private String rootPath;
    private boolean enabled;
    private boolean writable;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public SkillTarget setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public SkillTarget setName(String name) {
        this.name = name;
        return this;
    }

    public String getType() {
        return type;
    }

    public SkillTarget setType(String type) {
        this.type = type;
        return this;
    }

    public String getRootPath() {
        return rootPath;
    }

    public SkillTarget setRootPath(String rootPath) {
        this.rootPath = rootPath;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public SkillTarget setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public boolean isWritable() {
        return writable;
    }

    public SkillTarget setWritable(boolean writable) {
        this.writable = writable;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public SkillTarget setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public SkillTarget setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
