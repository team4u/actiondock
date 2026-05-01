package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.EventRecordRepository;

import java.util.List;

public class EventRecordApplicationService {
    private final EventRecordRepository eventRecordRepository;
    private final EventDispatchRepository eventDispatchRepository;

    public EventRecordApplicationService(EventRecordRepository eventRecordRepository,
                                         EventDispatchRepository eventDispatchRepository) {
        this.eventRecordRepository = eventRecordRepository;
        this.eventDispatchRepository = eventDispatchRepository;
    }

    public List<EventRecord> listAll() {
        return eventRecordRepository.findAll();
    }

    public List<EventRecord> listBySourceId(String sourceId) {
        return eventRecordRepository.findBySourceId(sourceId);
    }

    public EventRecord get(String id) {
        return eventRecordRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("事件记录不存在: " + id));
    }

    public java.util.List<EventDispatchRecord> listDispatches(String eventId) {
        get(eventId);
        return eventDispatchRepository.findByEventId(eventId);
    }
}
