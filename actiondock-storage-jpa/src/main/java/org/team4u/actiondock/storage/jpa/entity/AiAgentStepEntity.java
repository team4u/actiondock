package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_step")
public class AiAgentStepEntity {
    @Id
    private String id;
    private String runId;
    private Integer stepIndex;
    private String stepType;
    private String modelProfile;
    private String toolName;
    private String toolPermission;
    @Lob
    private String toolInputJson;
    @Lob
    private String toolOutputJson;
    private String status;
    private Long latencyMs;
    @Lob
    private String errorMessage;
    private LocalDateTime createdAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getRunId() { return runId; }
    public void setRunId(String runId) { this.runId = runId; }
    public Integer getStepIndex() { return stepIndex; }
    public void setStepIndex(Integer stepIndex) { this.stepIndex = stepIndex; }
    public String getStepType() { return stepType; }
    public void setStepType(String stepType) { this.stepType = stepType; }
    public String getModelProfile() { return modelProfile; }
    public void setModelProfile(String modelProfile) { this.modelProfile = modelProfile; }
    public String getToolName() { return toolName; }
    public void setToolName(String toolName) { this.toolName = toolName; }
    public String getToolPermission() { return toolPermission; }
    public void setToolPermission(String toolPermission) { this.toolPermission = toolPermission; }
    public String getToolInputJson() { return toolInputJson; }
    public void setToolInputJson(String toolInputJson) { this.toolInputJson = toolInputJson; }
    public String getToolOutputJson() { return toolOutputJson; }
    public void setToolOutputJson(String toolOutputJson) { this.toolOutputJson = toolOutputJson; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getLatencyMs() { return latencyMs; }
    public void setLatencyMs(Long latencyMs) { this.latencyMs = latencyMs; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
