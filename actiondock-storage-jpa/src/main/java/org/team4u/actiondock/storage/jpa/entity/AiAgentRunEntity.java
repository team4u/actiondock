package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_run")
public class AiAgentRunEntity {
    @Id
    private String id;
    private String agentProfile;
    private String status;
    private String callerType;
    private String scriptId;
    private String executionId;
    private String userId;
    @Lob
    private String inputSummaryJson;
    @Lob
    private String outputSummaryJson;
    private Integer totalModelCalls;
    private Integer totalToolCalls;
    private Integer totalTokens;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
    @Lob
    private String errorMessage;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getAgentProfile() { return agentProfile; }
    public void setAgentProfile(String agentProfile) { this.agentProfile = agentProfile; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getCallerType() { return callerType; }
    public void setCallerType(String callerType) { this.callerType = callerType; }
    public String getScriptId() { return scriptId; }
    public void setScriptId(String scriptId) { this.scriptId = scriptId; }
    public String getExecutionId() { return executionId; }
    public void setExecutionId(String executionId) { this.executionId = executionId; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getInputSummaryJson() { return inputSummaryJson; }
    public void setInputSummaryJson(String inputSummaryJson) { this.inputSummaryJson = inputSummaryJson; }
    public String getOutputSummaryJson() { return outputSummaryJson; }
    public void setOutputSummaryJson(String outputSummaryJson) { this.outputSummaryJson = outputSummaryJson; }
    public Integer getTotalModelCalls() { return totalModelCalls; }
    public void setTotalModelCalls(Integer totalModelCalls) { this.totalModelCalls = totalModelCalls; }
    public Integer getTotalToolCalls() { return totalToolCalls; }
    public void setTotalToolCalls(Integer totalToolCalls) { this.totalToolCalls = totalToolCalls; }
    public Integer getTotalTokens() { return totalTokens; }
    public void setTotalTokens(Integer totalTokens) { this.totalTokens = totalTokens; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
}
