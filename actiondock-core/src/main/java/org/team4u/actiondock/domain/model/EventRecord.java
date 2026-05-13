package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class EventRecord {
    private String id;
    private String sourceId;
    private String sourceKey;
    private EventRecordStatus status = EventRecordStatus.RECEIVED;
    private String eventType;
    private String eventId;
    private String actor;
    private String subject;
    private Map<String, Object> rawHeaders = new LinkedHashMap<>();
    private Map<String, Object> rawQuery = new LinkedHashMap<>();
    private Object rawBody = new LinkedHashMap<String, Object>();
    private NormalizedEvent normalizedEvent;
    private String errorMessage;
    private LocalDateTime createdAt;

    public String getId() {
        return id;
    }

    public EventRecord setId(String id) {
        this.id = id;
        return this;
    }

    public String getSourceId() {
        return sourceId;
    }

    public EventRecord setSourceId(String sourceId) {
        this.sourceId = sourceId;
        return this;
    }

    public String getSourceKey() {
        return sourceKey;
    }

    public EventRecord setSourceKey(String sourceKey) {
        this.sourceKey = sourceKey;
        return this;
    }

    public EventRecordStatus getStatus() {
        return status;
    }

    public EventRecord setStatus(EventRecordStatus status) {
        this.status = status == null ? EventRecordStatus.RECEIVED : status;
        return this;
    }

    public String getEventType() {
        return eventType;
    }

    public EventRecord setEventType(String eventType) {
        this.eventType = eventType;
        return this;
    }

    public String getEventId() {
        return eventId;
    }

    public EventRecord setEventId(String eventId) {
        this.eventId = eventId;
        return this;
    }

    public String getActor() {
        return actor;
    }

    public EventRecord setActor(String actor) {
        this.actor = actor;
        return this;
    }

    public String getSubject() {
        return subject;
    }

    public EventRecord setSubject(String subject) {
        this.subject = subject;
        return this;
    }

    public Map<String, Object> getRawHeaders() {
        return SchemaValueCopier.copyMap(rawHeaders);
    }

    public EventRecord setRawHeaders(Map<String, Object> rawHeaders) {
        this.rawHeaders = SchemaValueCopier.copyMap(rawHeaders);
        return this;
    }

    public Map<String, Object> getRawQuery() {
        return SchemaValueCopier.copyMap(rawQuery);
    }

    public EventRecord setRawQuery(Map<String, Object> rawQuery) {
        this.rawQuery = SchemaValueCopier.copyMap(rawQuery);
        return this;
    }

    public Object getRawBody() {
        return SchemaValueCopier.copyObject(rawBody);
    }

    public EventRecord setRawBody(Object rawBody) {
        this.rawBody = SchemaValueCopier.copyObject(rawBody);
        return this;
    }

    public NormalizedEvent getNormalizedEvent() {
        return normalizedEvent;
    }

    public EventRecord setNormalizedEvent(NormalizedEvent normalizedEvent) {
        this.normalizedEvent = normalizedEvent;
        return this;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public EventRecord setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public EventRecord setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }
}
