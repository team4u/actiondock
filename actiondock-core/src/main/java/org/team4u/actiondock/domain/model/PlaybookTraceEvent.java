package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class PlaybookTraceEvent {
    private String id;
    private String sessionId;
    private String externalEventId;
    private long sequence;
    private PlaybookPhase phase;
    private PlaybookTraceEventType type;
    private String actor = "agent";
    private String message;
    private String refType;
    private String refId;
    private String decision;
    private String reason;
    private PlaybookRiskLevel observedRisk;
    private boolean stopConditionHit;
    private String stopCondition;
    private Map<String, Object> payload = new LinkedHashMap<>();
    private boolean redacted;
    private List<String> redactedFields = List.of();
    private LocalDateTime createdAt;

    public String getId() { return id; }
    public PlaybookTraceEvent setId(String id) { this.id = id; return this; }
    public String getSessionId() { return sessionId; }
    public PlaybookTraceEvent setSessionId(String sessionId) { this.sessionId = sessionId; return this; }
    public String getExternalEventId() { return externalEventId; }
    public PlaybookTraceEvent setExternalEventId(String externalEventId) { this.externalEventId = externalEventId; return this; }
    public long getSequence() { return sequence; }
    public PlaybookTraceEvent setSequence(long sequence) { this.sequence = sequence; return this; }
    public PlaybookPhase getPhase() { return phase; }
    public PlaybookTraceEvent setPhase(PlaybookPhase phase) { this.phase = phase; return this; }
    public PlaybookTraceEventType getType() { return type; }
    public PlaybookTraceEvent setType(PlaybookTraceEventType type) { this.type = type; return this; }
    public String getActor() { return actor; }
    public PlaybookTraceEvent setActor(String actor) { this.actor = actor; return this; }
    public String getMessage() { return message; }
    public PlaybookTraceEvent setMessage(String message) { this.message = message; return this; }
    public String getRefType() { return refType; }
    public PlaybookTraceEvent setRefType(String refType) { this.refType = refType; return this; }
    public String getRefId() { return refId; }
    public PlaybookTraceEvent setRefId(String refId) { this.refId = refId; return this; }
    public String getDecision() { return decision; }
    public PlaybookTraceEvent setDecision(String decision) { this.decision = decision; return this; }
    public String getReason() { return reason; }
    public PlaybookTraceEvent setReason(String reason) { this.reason = reason; return this; }
    public PlaybookRiskLevel getObservedRisk() { return observedRisk; }
    public PlaybookTraceEvent setObservedRisk(PlaybookRiskLevel observedRisk) { this.observedRisk = observedRisk; return this; }
    public boolean isStopConditionHit() { return stopConditionHit; }
    public PlaybookTraceEvent setStopConditionHit(boolean stopConditionHit) { this.stopConditionHit = stopConditionHit; return this; }
    public String getStopCondition() { return stopCondition; }
    public PlaybookTraceEvent setStopCondition(String stopCondition) { this.stopCondition = stopCondition; return this; }
    public Map<String, Object> getPayload() { return new LinkedHashMap<>(payload); }
    public PlaybookTraceEvent setPayload(Map<String, Object> payload) {
        this.payload = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
        return this;
    }
    public boolean isRedacted() { return redacted; }
    public PlaybookTraceEvent setRedacted(boolean redacted) { this.redacted = redacted; return this; }
    public List<String> getRedactedFields() { return List.copyOf(redactedFields); }
    public PlaybookTraceEvent setRedactedFields(List<String> redactedFields) {
        this.redactedFields = redactedFields == null ? List.of() : List.copyOf(redactedFields);
        return this;
    }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public PlaybookTraceEvent setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; return this; }
}
