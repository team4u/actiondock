package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_toolset")
public class AiToolsetEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String name;
    @Lob
    private String description;
    @Lob
    @Column(nullable = false)
    private String toolNamesJson;
    @Lob
    private String toolOptionsJson;
    @Column(nullable = false)
    private String maxPermission;
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getToolNamesJson() { return toolNamesJson; }
    public void setToolNamesJson(String toolNamesJson) { this.toolNamesJson = toolNamesJson; }
    public String getToolOptionsJson() { return toolOptionsJson; }
    public void setToolOptionsJson(String toolOptionsJson) { this.toolOptionsJson = toolOptionsJson; }
    public String getMaxPermission() { return maxPermission; }
    public void setMaxPermission(String maxPermission) { this.maxPermission = maxPermission; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
