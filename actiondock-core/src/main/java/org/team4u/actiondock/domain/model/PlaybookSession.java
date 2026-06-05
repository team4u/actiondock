package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class PlaybookSession {
    private String id;
    private String playbookId;
    private String playbookName;
    private String playbookVersion;
    private String playbookSnapshotHash;
    private String userPrompt;
    private String intent;
    private String agentName;
    private String agentRunId;
    private List<String> repositoryIds = new ArrayList<>();
    private PlaybookRiskLevel riskLevelSnapshot;
    private List<String> stopConditionsSnapshot = new ArrayList<>();
    private PlaybookSessionStatus status = PlaybookSessionStatus.RUNNING;
    private PlaybookPhase currentPhase = PlaybookPhase.ROUTE;
    private String parentSessionId;
    private String handoffFromSessionId;
    private String handoffRelation;
    private LocalDateTime startedAt;
    private LocalDateTime updatedAt;
    private LocalDateTime endedAt;
    private String finalSummary;
    private String failureReason;

    public String getId() { return id; }
    public PlaybookSession setId(String id) { this.id = id; return this; }
    public String getPlaybookId() { return playbookId; }
    public PlaybookSession setPlaybookId(String playbookId) { this.playbookId = playbookId; return this; }
    public String getPlaybookName() { return playbookName; }
    public PlaybookSession setPlaybookName(String playbookName) { this.playbookName = playbookName; return this; }
    public String getPlaybookVersion() { return playbookVersion; }
    public PlaybookSession setPlaybookVersion(String playbookVersion) { this.playbookVersion = playbookVersion; return this; }
    public String getPlaybookSnapshotHash() { return playbookSnapshotHash; }
    public PlaybookSession setPlaybookSnapshotHash(String playbookSnapshotHash) { this.playbookSnapshotHash = playbookSnapshotHash; return this; }
    public String getUserPrompt() { return userPrompt; }
    public PlaybookSession setUserPrompt(String userPrompt) { this.userPrompt = userPrompt; return this; }
    public String getIntent() { return intent; }
    public PlaybookSession setIntent(String intent) { this.intent = intent; return this; }
    public String getAgentName() { return agentName; }
    public PlaybookSession setAgentName(String agentName) { this.agentName = agentName; return this; }
    public String getAgentRunId() { return agentRunId; }
    public PlaybookSession setAgentRunId(String agentRunId) { this.agentRunId = agentRunId; return this; }
    public List<String> getRepositoryIds() { return List.copyOf(repositoryIds); }
    public PlaybookSession setRepositoryIds(List<String> repositoryIds) {
        this.repositoryIds = repositoryIds == null ? new ArrayList<>() : new ArrayList<>(repositoryIds);
        return this;
    }
    public PlaybookRiskLevel getRiskLevelSnapshot() { return riskLevelSnapshot; }
    public PlaybookSession setRiskLevelSnapshot(PlaybookRiskLevel riskLevelSnapshot) { this.riskLevelSnapshot = riskLevelSnapshot; return this; }
    public List<String> getStopConditionsSnapshot() { return List.copyOf(stopConditionsSnapshot); }
    public PlaybookSession setStopConditionsSnapshot(List<String> stopConditionsSnapshot) {
        this.stopConditionsSnapshot = stopConditionsSnapshot == null ? new ArrayList<>() : new ArrayList<>(stopConditionsSnapshot);
        return this;
    }
    public PlaybookSessionStatus getStatus() { return status; }
    public PlaybookSession setStatus(PlaybookSessionStatus status) {
        this.status = status == null ? PlaybookSessionStatus.RUNNING : status;
        return this;
    }
    public PlaybookPhase getCurrentPhase() { return currentPhase; }
    public PlaybookSession setCurrentPhase(PlaybookPhase currentPhase) {
        this.currentPhase = currentPhase == null ? PlaybookPhase.ROUTE : currentPhase;
        return this;
    }
    public String getParentSessionId() { return parentSessionId; }
    public PlaybookSession setParentSessionId(String parentSessionId) { this.parentSessionId = parentSessionId; return this; }
    public String getHandoffFromSessionId() { return handoffFromSessionId; }
    public PlaybookSession setHandoffFromSessionId(String handoffFromSessionId) { this.handoffFromSessionId = handoffFromSessionId; return this; }
    public String getHandoffRelation() { return handoffRelation; }
    public PlaybookSession setHandoffRelation(String handoffRelation) { this.handoffRelation = handoffRelation; return this; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public PlaybookSession setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; return this; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public PlaybookSession setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; return this; }
    public LocalDateTime getEndedAt() { return endedAt; }
    public PlaybookSession setEndedAt(LocalDateTime endedAt) { this.endedAt = endedAt; return this; }
    public String getFinalSummary() { return finalSummary; }
    public PlaybookSession setFinalSummary(String finalSummary) { this.finalSummary = finalSummary; return this; }
    public String getFailureReason() { return failureReason; }
    public PlaybookSession setFailureReason(String failureReason) { this.failureReason = failureReason; return this; }

    public boolean isClosed() {
        return status == PlaybookSessionStatus.STOPPED
                || status == PlaybookSessionStatus.HANDED_OFF
                || status == PlaybookSessionStatus.COMPLETED
                || status == PlaybookSessionStatus.FAILED
                || status == PlaybookSessionStatus.CANCELLED;
    }
}
