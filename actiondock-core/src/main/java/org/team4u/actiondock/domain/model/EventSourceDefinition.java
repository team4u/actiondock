package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class EventSourceDefinition {
    private String id;
    private String key;
    private String name;
    private String description;
    private boolean enabled = true;
    private EventSourceTransport transport = new EventSourceTransport();
    private EventSourceAuthConfig auth;
    private ProcessorDefinition normalizationProcessor;
    private Map<String, Object> sampleContext = new LinkedHashMap<>();
    private LocalDateTime lastReceivedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public EventSourceDefinition setId(String id) {
        this.id = id;
        return this;
    }

    public String getKey() {
        return key;
    }

    public EventSourceDefinition setKey(String key) {
        this.key = key;
        return this;
    }

    public String getName() {
        return name;
    }

    public EventSourceDefinition setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public EventSourceDefinition setDescription(String description) {
        this.description = description;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public EventSourceDefinition setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public EventSourceTransport getTransport() {
        return transport;
    }

    public EventSourceDefinition setTransport(EventSourceTransport transport) {
        this.transport = transport == null ? new EventSourceTransport() : transport;
        return this;
    }

    public EventSourceAuthConfig getAuth() {
        return auth;
    }

    public EventSourceDefinition setAuth(EventSourceAuthConfig auth) {
        this.auth = auth;
        return this;
    }

    public ProcessorDefinition getNormalizationProcessor() {
        return normalizationProcessor;
    }

    public EventSourceDefinition setNormalizationProcessor(ProcessorDefinition normalizationProcessor) {
        this.normalizationProcessor = normalizationProcessor;
        return this;
    }

    public Map<String, Object> getSampleContext() {
        return SchemaValueCopier.copyMap(sampleContext);
    }

    public EventSourceDefinition setSampleContext(Map<String, Object> sampleContext) {
        this.sampleContext = SchemaValueCopier.copyMap(sampleContext);
        return this;
    }

    public LocalDateTime getLastReceivedAt() {
        return lastReceivedAt;
    }

    public EventSourceDefinition setLastReceivedAt(LocalDateTime lastReceivedAt) {
        this.lastReceivedAt = lastReceivedAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public EventSourceDefinition setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public EventSourceDefinition setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
