package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_profile")
public class AiAgentProfileEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String name;
    @Lob
    private String description;
    @Column(nullable = false)
    private String provider;
    @Column(nullable = false)
    private String modelProfileId;
    @Lob
    private String systemPrompt;
    @Lob
    private String toolsetIdsJson;
    @Lob
    private String directToolNamesJson;
    @Lob
    private String directToolOptionsJson;
    @Lob
    private String skillIdsJson;
    @Lob
    private String optionsJson;
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }
    public String getModelProfileId() { return modelProfileId; }
    public void setModelProfileId(String modelProfileId) { this.modelProfileId = modelProfileId; }
    public String getSystemPrompt() { return systemPrompt; }
    public void setSystemPrompt(String systemPrompt) { this.systemPrompt = systemPrompt; }
    public String getToolsetIdsJson() { return toolsetIdsJson; }
    public void setToolsetIdsJson(String toolsetIdsJson) { this.toolsetIdsJson = toolsetIdsJson; }
    public String getDirectToolNamesJson() { return directToolNamesJson; }
    public void setDirectToolNamesJson(String directToolNamesJson) { this.directToolNamesJson = directToolNamesJson; }
    public String getDirectToolOptionsJson() { return directToolOptionsJson; }
    public void setDirectToolOptionsJson(String directToolOptionsJson) { this.directToolOptionsJson = directToolOptionsJson; }
    public String getSkillIdsJson() { return skillIdsJson; }
    public void setSkillIdsJson(String skillIdsJson) { this.skillIdsJson = skillIdsJson; }
    public String getOptionsJson() { return optionsJson; }
    public void setOptionsJson(String optionsJson) { this.optionsJson = optionsJson; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
