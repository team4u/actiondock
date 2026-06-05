package org.team4u.actiondock.web.playbook;

import org.team4u.actiondock.domain.model.PlaybookPhase;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookTraceEventType;

import java.util.Map;

public class PlaybookTraceEventRequest {
    private String externalEventId;
    private PlaybookPhase phase;
    private PlaybookTraceEventType type;
    private String actor;
    private String message;
    private String refType;
    private String refId;
    private String decision;
    private String reason;
    private PlaybookRiskLevel observedRisk;
    private Boolean stopConditionHit;
    private String stopCondition;
    private Map<String, Object> payload;

    public String getExternalEventId() { return externalEventId; }
    public void setExternalEventId(String externalEventId) { this.externalEventId = externalEventId; }
    public PlaybookPhase getPhase() { return phase; }
    public void setPhase(PlaybookPhase phase) { this.phase = phase; }
    public PlaybookTraceEventType getType() { return type; }
    public void setType(PlaybookTraceEventType type) { this.type = type; }
    public String getActor() { return actor; }
    public void setActor(String actor) { this.actor = actor; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public String getRefType() { return refType; }
    public void setRefType(String refType) { this.refType = refType; }
    public String getRefId() { return refId; }
    public void setRefId(String refId) { this.refId = refId; }
    public String getDecision() { return decision; }
    public void setDecision(String decision) { this.decision = decision; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public PlaybookRiskLevel getObservedRisk() { return observedRisk; }
    public void setObservedRisk(PlaybookRiskLevel observedRisk) { this.observedRisk = observedRisk; }
    public Boolean getStopConditionHit() { return stopConditionHit; }
    public void setStopConditionHit(Boolean stopConditionHit) { this.stopConditionHit = stopConditionHit; }
    public String getStopCondition() { return stopCondition; }
    public void setStopCondition(String stopCondition) { this.stopCondition = stopCondition; }
    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
}
