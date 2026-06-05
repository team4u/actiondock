package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "playbook_session", indexes = {
        @Index(name = "idx_playbook_session_playbook", columnList = "playbookId"),
        @Index(name = "idx_playbook_session_agent_run", columnList = "agentRunId"),
        @Index(name = "idx_playbook_session_status", columnList = "status")
})
public class PlaybookSessionEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String playbookId;
    private String playbookName;
    private String playbookVersion;
    private String playbookSnapshotHash;
    @Lob
    private String userPrompt;
    @Lob
    private String intent;
    private String agentName;
    private String agentRunId;
    @Lob
    private String repositoryIdsJson;
    private String riskLevelSnapshot;
    @Lob
    private String stopConditionsSnapshotJson;
    @Column(nullable = false)
    private String status;
    @Column(nullable = false)
    private String currentPhase;
    private String parentSessionId;
    private String handoffFromSessionId;
    private String handoffRelation;
    private LocalDateTime startedAt;
    private LocalDateTime updatedAt;
    private LocalDateTime endedAt;
    @Lob
    private String finalSummary;
    @Lob
    private String failureReason;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getPlaybookId() { return playbookId; }
    public void setPlaybookId(String playbookId) { this.playbookId = playbookId; }
    public String getPlaybookName() { return playbookName; }
    public void setPlaybookName(String playbookName) { this.playbookName = playbookName; }
    public String getPlaybookVersion() { return playbookVersion; }
    public void setPlaybookVersion(String playbookVersion) { this.playbookVersion = playbookVersion; }
    public String getPlaybookSnapshotHash() { return playbookSnapshotHash; }
    public void setPlaybookSnapshotHash(String playbookSnapshotHash) { this.playbookSnapshotHash = playbookSnapshotHash; }
    public String getUserPrompt() { return userPrompt; }
    public void setUserPrompt(String userPrompt) { this.userPrompt = userPrompt; }
    public String getIntent() { return intent; }
    public void setIntent(String intent) { this.intent = intent; }
    public String getAgentName() { return agentName; }
    public void setAgentName(String agentName) { this.agentName = agentName; }
    public String getAgentRunId() { return agentRunId; }
    public void setAgentRunId(String agentRunId) { this.agentRunId = agentRunId; }
    public String getRepositoryIdsJson() { return repositoryIdsJson; }
    public void setRepositoryIdsJson(String repositoryIdsJson) { this.repositoryIdsJson = repositoryIdsJson; }
    public String getRiskLevelSnapshot() { return riskLevelSnapshot; }
    public void setRiskLevelSnapshot(String riskLevelSnapshot) { this.riskLevelSnapshot = riskLevelSnapshot; }
    public String getStopConditionsSnapshotJson() { return stopConditionsSnapshotJson; }
    public void setStopConditionsSnapshotJson(String stopConditionsSnapshotJson) { this.stopConditionsSnapshotJson = stopConditionsSnapshotJson; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getCurrentPhase() { return currentPhase; }
    public void setCurrentPhase(String currentPhase) { this.currentPhase = currentPhase; }
    public String getParentSessionId() { return parentSessionId; }
    public void setParentSessionId(String parentSessionId) { this.parentSessionId = parentSessionId; }
    public String getHandoffFromSessionId() { return handoffFromSessionId; }
    public void setHandoffFromSessionId(String handoffFromSessionId) { this.handoffFromSessionId = handoffFromSessionId; }
    public String getHandoffRelation() { return handoffRelation; }
    public void setHandoffRelation(String handoffRelation) { this.handoffRelation = handoffRelation; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getEndedAt() { return endedAt; }
    public void setEndedAt(LocalDateTime endedAt) { this.endedAt = endedAt; }
    public String getFinalSummary() { return finalSummary; }
    public void setFinalSummary(String finalSummary) { this.finalSummary = finalSummary; }
    public String getFailureReason() { return failureReason; }
    public void setFailureReason(String failureReason) { this.failureReason = failureReason; }
}
