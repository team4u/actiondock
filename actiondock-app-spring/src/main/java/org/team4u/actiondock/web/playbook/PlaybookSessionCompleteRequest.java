package org.team4u.actiondock.web.playbook;

import org.team4u.actiondock.domain.model.PlaybookSessionStatus;

public class PlaybookSessionCompleteRequest {
    private PlaybookSessionStatus status = PlaybookSessionStatus.COMPLETED;
    private String finalSummary;
    private String failureReason;

    public PlaybookSessionStatus getStatus() { return status; }
    public void setStatus(PlaybookSessionStatus status) { this.status = status; }
    public String getFinalSummary() { return finalSummary; }
    public void setFinalSummary(String finalSummary) { this.finalSummary = finalSummary; }
    public String getFailureReason() { return failureReason; }
    public void setFailureReason(String failureReason) { this.failureReason = failureReason; }
}
