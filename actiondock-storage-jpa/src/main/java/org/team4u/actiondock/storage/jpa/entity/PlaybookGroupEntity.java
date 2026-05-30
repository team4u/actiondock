package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "playbook_group")
public class PlaybookGroupEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String name;
    @Lob
    private String description;
    @Lob
    private String tagsJson;
    @Lob
    private String defaultRepositoryIdsJson;
    private boolean enabled = true;
    private boolean managed;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getTagsJson() { return tagsJson; }
    public void setTagsJson(String tagsJson) { this.tagsJson = tagsJson; }
    public String getDefaultRepositoryIdsJson() { return defaultRepositoryIdsJson; }
    public void setDefaultRepositoryIdsJson(String defaultRepositoryIdsJson) { this.defaultRepositoryIdsJson = defaultRepositoryIdsJson; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean isManaged() { return managed; }
    public void setManaged(boolean managed) { this.managed = managed; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
