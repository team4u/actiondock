package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventWebhookResponsePayload;
import org.team4u.actiondock.domain.model.ExecutionRecord;

import java.util.ArrayList;
import java.util.List;

public class EventIngestionResult {
    private EventRecord eventRecord;
    private List<EventDispatchRecord> dispatches = new ArrayList<>();
    private List<ExecutionRecord> syncExecutions = new ArrayList<>();
    private EventWebhookResponsePayload webhookResponse;

    public EventRecord getEventRecord() {
        return eventRecord;
    }

    public EventIngestionResult setEventRecord(EventRecord eventRecord) {
        this.eventRecord = eventRecord;
        return this;
    }

    public List<EventDispatchRecord> getDispatches() {
        return List.copyOf(dispatches);
    }

    public EventIngestionResult setDispatches(List<EventDispatchRecord> dispatches) {
        this.dispatches = dispatches == null ? new ArrayList<>() : new ArrayList<>(dispatches);
        return this;
    }

    public List<ExecutionRecord> getSyncExecutions() {
        return List.copyOf(syncExecutions);
    }

    public EventIngestionResult setSyncExecutions(List<ExecutionRecord> syncExecutions) {
        this.syncExecutions = syncExecutions == null ? new ArrayList<>() : new ArrayList<>(syncExecutions);
        return this;
    }

    public EventWebhookResponsePayload getWebhookResponse() {
        return webhookResponse;
    }

    public EventIngestionResult setWebhookResponse(EventWebhookResponsePayload webhookResponse) {
        this.webhookResponse = webhookResponse;
        return this;
    }
}
