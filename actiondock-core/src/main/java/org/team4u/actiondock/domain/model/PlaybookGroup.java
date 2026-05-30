package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class PlaybookGroup {
    private String id;
    private String name;
    private String description;
    private List<String> tags = new ArrayList<>();
    private List<String> defaultRepositoryIds = new ArrayList<>();
    private boolean enabled = true;
    private boolean managed;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public PlaybookGroup setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public PlaybookGroup setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PlaybookGroup setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getTags() {
        return List.copyOf(tags);
    }

    public PlaybookGroup setTags(List<String> tags) {
        this.tags = tags == null ? new ArrayList<>() : new ArrayList<>(tags);
        return this;
    }

    public List<String> getDefaultRepositoryIds() {
        return List.copyOf(defaultRepositoryIds);
    }

    public PlaybookGroup setDefaultRepositoryIds(List<String> defaultRepositoryIds) {
        this.defaultRepositoryIds = defaultRepositoryIds == null ? new ArrayList<>() : new ArrayList<>(defaultRepositoryIds);
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public PlaybookGroup setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public boolean isManaged() {
        return managed;
    }

    public PlaybookGroup setManaged(boolean managed) {
        this.managed = managed;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public PlaybookGroup setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public PlaybookGroup setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
