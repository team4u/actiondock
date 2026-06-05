package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.LocalDateTime;

@Entity
@Table(name = "playbook_trace_event", indexes = {
        @Index(name = "idx_playbook_trace_event_session", columnList = "sessionId"),
        @Index(name = "idx_playbook_trace_event_type", columnList = "type")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_playbook_trace_session_sequence", columnNames = {"sessionId", "sequence"}),
        @UniqueConstraint(name = "uk_playbook_trace_external_event", columnNames = {"sessionId", "externalEventId"})
})
public class PlaybookTraceEventEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String sessionId;
    private String externalEventId;
    @Column(nullable = false)
    private long sequence;
    @Column(nullable = false)
    private String phase;
    @Column(nullable = false)
    private String type;
    private String actor;
    @Lob
    private String message;
    private String refType;
    private String refId;
    private String decision;
    @Lob
    private String reason;
    private String observedRisk;
    private boolean stopConditionHit;
    @Lob
    private String stopCondition;
    @Lob
    private String payloadJson;
    private boolean redacted;
    @Lob
    private String redactedFieldsJson;
    private LocalDateTime createdAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getExternalEventId() { return externalEventId; }
    public void setExternalEventId(String externalEventId) { this.externalEventId = externalEventId; }
    public long getSequence() { return sequence; }
    public void setSequence(long sequence) { this.sequence = sequence; }
    public String getPhase() { return phase; }
    public void setPhase(String phase) { this.phase = phase; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
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
    public String getObservedRisk() { return observedRisk; }
    public void setObservedRisk(String observedRisk) { this.observedRisk = observedRisk; }
    public boolean isStopConditionHit() { return stopConditionHit; }
    public void setStopConditionHit(boolean stopConditionHit) { this.stopConditionHit = stopConditionHit; }
    public String getStopCondition() { return stopCondition; }
    public void setStopCondition(String stopCondition) { this.stopCondition = stopCondition; }
    public String getPayloadJson() { return payloadJson; }
    public void setPayloadJson(String payloadJson) { this.payloadJson = payloadJson; }
    public boolean isRedacted() { return redacted; }
    public void setRedacted(boolean redacted) { this.redacted = redacted; }
    public String getRedactedFieldsJson() { return redactedFieldsJson; }
    public void setRedactedFieldsJson(String redactedFieldsJson) { this.redactedFieldsJson = redactedFieldsJson; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
