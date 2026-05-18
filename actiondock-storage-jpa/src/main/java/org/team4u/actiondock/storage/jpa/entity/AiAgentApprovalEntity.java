package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_agent_approval")
public class AiAgentApprovalEntity {
    @Id
    private String id;
    private String runId;
    private String stepId;
    private String actionType;
    @Lob
    private String proposedPayloadJson;
    private String status;
    private LocalDateTime requestedAt;
    private String approvedBy;
    private LocalDateTime approvedAt;
    @Lob
    private String rejectReason;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getRunId() { return runId; }
    public void setRunId(String runId) { this.runId = runId; }
    public String getStepId() { return stepId; }
    public void setStepId(String stepId) { this.stepId = stepId; }
    public String getActionType() { return actionType; }
    public void setActionType(String actionType) { this.actionType = actionType; }
    public String getProposedPayloadJson() { return proposedPayloadJson; }
    public void setProposedPayloadJson(String proposedPayloadJson) { this.proposedPayloadJson = proposedPayloadJson; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getRequestedAt() { return requestedAt; }
    public void setRequestedAt(LocalDateTime requestedAt) { this.requestedAt = requestedAt; }
    public String getApprovedBy() { return approvedBy; }
    public void setApprovedBy(String approvedBy) { this.approvedBy = approvedBy; }
    public LocalDateTime getApprovedAt() { return approvedAt; }
    public void setApprovedAt(LocalDateTime approvedAt) { this.approvedAt = approvedAt; }
    public String getRejectReason() { return rejectReason; }
    public void setRejectReason(String rejectReason) { this.rejectReason = rejectReason; }
}
