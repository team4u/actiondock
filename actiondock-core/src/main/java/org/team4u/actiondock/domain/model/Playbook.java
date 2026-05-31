package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class Playbook {
    private String id;
    private String name;
    private String description;
    private List<String> tags = new ArrayList<>();
    private PlaybookRiskLevel riskLevel;
    private List<String> repositoryIds = new ArrayList<>();
    private List<PlaybookKnowledgeRef> knowledgeRefs = new ArrayList<>();
    private List<PlaybookScriptRef> scriptRefs = new ArrayList<>();
    private List<PlaybookAgentSkillRef> agentSkillRefs = new ArrayList<>();
    private List<PlaybookRelatedRef> relatedPlaybookRefs = new ArrayList<>();
    private String guideMarkdown;
    private List<String> stopConditions = new ArrayList<>();
    private boolean enabled = true;
    private boolean managed;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public Playbook setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public Playbook setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public Playbook setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getTags() {
        return List.copyOf(tags);
    }

    public Playbook setTags(List<String> tags) {
        this.tags = tags == null ? new ArrayList<>() : new ArrayList<>(tags);
        return this;
    }

    public PlaybookRiskLevel getRiskLevel() {
        return riskLevel;
    }

    public Playbook setRiskLevel(PlaybookRiskLevel riskLevel) {
        this.riskLevel = riskLevel;
        return this;
    }

    public List<String> getRepositoryIds() {
        return List.copyOf(repositoryIds);
    }

    public Playbook setRepositoryIds(List<String> repositoryIds) {
        this.repositoryIds = repositoryIds == null ? new ArrayList<>() : new ArrayList<>(repositoryIds);
        return this;
    }

    public List<PlaybookKnowledgeRef> getKnowledgeRefs() {
        return List.copyOf(knowledgeRefs);
    }

    public Playbook setKnowledgeRefs(List<PlaybookKnowledgeRef> knowledgeRefs) {
        this.knowledgeRefs = knowledgeRefs == null ? new ArrayList<>() : new ArrayList<>(knowledgeRefs);
        return this;
    }

    public List<PlaybookScriptRef> getScriptRefs() {
        return List.copyOf(scriptRefs);
    }

    public Playbook setScriptRefs(List<PlaybookScriptRef> scriptRefs) {
        this.scriptRefs = scriptRefs == null ? new ArrayList<>() : new ArrayList<>(scriptRefs);
        return this;
    }

    public List<PlaybookAgentSkillRef> getAgentSkillRefs() {
        return List.copyOf(agentSkillRefs);
    }

    public Playbook setAgentSkillRefs(List<PlaybookAgentSkillRef> agentSkillRefs) {
        this.agentSkillRefs = agentSkillRefs == null ? new ArrayList<>() : new ArrayList<>(agentSkillRefs);
        return this;
    }

    public List<PlaybookRelatedRef> getRelatedPlaybookRefs() {
        return List.copyOf(relatedPlaybookRefs);
    }

    public Playbook setRelatedPlaybookRefs(List<PlaybookRelatedRef> relatedPlaybookRefs) {
        this.relatedPlaybookRefs = relatedPlaybookRefs == null ? new ArrayList<>() : new ArrayList<>(relatedPlaybookRefs);
        return this;
    }

    public String getGuideMarkdown() {
        return guideMarkdown;
    }

    public Playbook setGuideMarkdown(String guideMarkdown) {
        this.guideMarkdown = guideMarkdown;
        return this;
    }

    public List<String> getStopConditions() {
        return List.copyOf(stopConditions);
    }

    public Playbook setStopConditions(List<String> stopConditions) {
        this.stopConditions = stopConditions == null ? new ArrayList<>() : new ArrayList<>(stopConditions);
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public Playbook setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public boolean isManaged() {
        return managed;
    }

    public Playbook setManaged(boolean managed) {
        this.managed = managed;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public Playbook setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public Playbook setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
