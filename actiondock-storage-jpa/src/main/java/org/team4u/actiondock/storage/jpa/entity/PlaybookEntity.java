package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "playbook", indexes = {
        @Index(name = "idx_playbook_enabled", columnList = "enabled"),
        @Index(name = "idx_playbook_managed", columnList = "managed")
})
public class PlaybookEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String name;
    @Lob
    private String description;
    @Lob
    private String tagsJson;
    private String riskLevel;
    @Lob
    private String repositoryIdsJson;
    @Lob
    private String knowledgeRefsJson;
    @Lob
    private String scriptRefsJson;
    @Lob
    private String agentSkillRefsJson;
    @Lob
    private String relatedPlaybookRefsJson;
    @Lob
    @Column(nullable = false)
    private String guideMarkdown;
    @Lob
    private String stopConditionsJson;
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
    public String getRiskLevel() { return riskLevel; }
    public void setRiskLevel(String riskLevel) { this.riskLevel = riskLevel; }
    public String getRepositoryIdsJson() { return repositoryIdsJson; }
    public void setRepositoryIdsJson(String repositoryIdsJson) { this.repositoryIdsJson = repositoryIdsJson; }
    public String getKnowledgeRefsJson() { return knowledgeRefsJson; }
    public void setKnowledgeRefsJson(String knowledgeRefsJson) { this.knowledgeRefsJson = knowledgeRefsJson; }
    public String getScriptRefsJson() { return scriptRefsJson; }
    public void setScriptRefsJson(String scriptRefsJson) { this.scriptRefsJson = scriptRefsJson; }
    public String getAgentSkillRefsJson() { return agentSkillRefsJson; }
    public void setAgentSkillRefsJson(String agentSkillRefsJson) { this.agentSkillRefsJson = agentSkillRefsJson; }
    public String getRelatedPlaybookRefsJson() { return relatedPlaybookRefsJson; }
    public void setRelatedPlaybookRefsJson(String relatedPlaybookRefsJson) { this.relatedPlaybookRefsJson = relatedPlaybookRefsJson; }
    public String getGuideMarkdown() { return guideMarkdown; }
    public void setGuideMarkdown(String guideMarkdown) { this.guideMarkdown = guideMarkdown; }
    public String getStopConditionsJson() { return stopConditionsJson; }
    public void setStopConditionsJson(String stopConditionsJson) { this.stopConditionsJson = stopConditionsJson; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean isManaged() { return managed; }
    public void setManaged(boolean managed) { this.managed = managed; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
