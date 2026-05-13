package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class NormalizedEvent {
    private String id;
    private String sourceId;
    private String sourceKey;
    private String eventType;
    private String eventId;
    private String actor;
    private String subject;
    private String timestamp;
    private Map<String, Object> headers = new LinkedHashMap<>();
    private Map<String, Object> query = new LinkedHashMap<>();
    private Object body = new LinkedHashMap<String, Object>();
    private String rawBody;
    private LocalDateTime receivedAt;

    public String getId() {
        return id;
    }

    public NormalizedEvent setId(String id) {
        this.id = id;
        return this;
    }

    public String getSourceId() {
        return sourceId;
    }

    public NormalizedEvent setSourceId(String sourceId) {
        this.sourceId = sourceId;
        return this;
    }

    public String getSourceKey() {
        return sourceKey;
    }

    public NormalizedEvent setSourceKey(String sourceKey) {
        this.sourceKey = sourceKey;
        return this;
    }

    public String getEventType() {
        return eventType;
    }

    public NormalizedEvent setEventType(String eventType) {
        this.eventType = eventType;
        return this;
    }

    public String getEventId() {
        return eventId;
    }

    public NormalizedEvent setEventId(String eventId) {
        this.eventId = eventId;
        return this;
    }

    public String getActor() {
        return actor;
    }

    public NormalizedEvent setActor(String actor) {
        this.actor = actor;
        return this;
    }

    public String getSubject() {
        return subject;
    }

    public NormalizedEvent setSubject(String subject) {
        this.subject = subject;
        return this;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public NormalizedEvent setTimestamp(String timestamp) {
        this.timestamp = timestamp;
        return this;
    }

    public Map<String, Object> getHeaders() {
        return SchemaValueCopier.copyMap(headers);
    }

    public NormalizedEvent setHeaders(Map<String, Object> headers) {
        this.headers = SchemaValueCopier.copyMap(headers);
        return this;
    }

    public Map<String, Object> getQuery() {
        return SchemaValueCopier.copyMap(query);
    }

    public NormalizedEvent setQuery(Map<String, Object> query) {
        this.query = SchemaValueCopier.copyMap(query);
        return this;
    }

    public Object getBody() {
        return SchemaValueCopier.copyObject(body);
    }

    public NormalizedEvent setBody(Object body) {
        this.body = SchemaValueCopier.copyObject(body);
        return this;
    }

    public String getRawBody() {
        return rawBody;
    }

    public NormalizedEvent setRawBody(String rawBody) {
        this.rawBody = rawBody;
        return this;
    }

    public LocalDateTime getReceivedAt() {
        return receivedAt;
    }

    public NormalizedEvent setReceivedAt(LocalDateTime receivedAt) {
        this.receivedAt = receivedAt;
        return this;
    }
}
