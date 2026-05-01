package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventRecord;

import java.util.ArrayList;
import java.util.List;

public class EventIngestionResult {
    private EventRecord eventRecord;
    private List<EventDispatchRecord> dispatches = new ArrayList<>();

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
}
