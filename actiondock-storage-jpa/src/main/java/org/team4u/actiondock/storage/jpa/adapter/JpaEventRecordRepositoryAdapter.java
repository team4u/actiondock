package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.EventRecordEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataEventRecordEntityRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaEventRecordRepositoryAdapter implements EventRecordRepository {
    private final SpringDataEventRecordEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaEventRecordRepositoryAdapter(SpringDataEventRecordEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public EventRecord save(EventRecord record) {
        return toDomain(repository.save(toEntity(record)));
    }

    @Override
    public Optional<EventRecord> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<EventRecord> findAll() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(this::toDomain).toList();
    }

    @Override
    public List<EventRecord> findBySourceId(String sourceId) {
        return repository.findBySourceIdOrderByCreatedAtDesc(sourceId).stream().map(this::toDomain).toList();
    }

    private EventRecordEntity toEntity(EventRecord record) {
        EventRecordEntity entity = new EventRecordEntity();
        entity.setId(record.getId());
        entity.setSourceId(record.getSourceId());
        entity.setSourceKey(record.getSourceKey());
        entity.setStatus(record.getStatus().name());
        entity.setEventType(record.getEventType());
        entity.setExternalEventId(record.getEventId());
        entity.setActor(record.getActor());
        entity.setSubject(record.getSubject());
        entity.setRawHeadersJson(jsonCodec.write(record.getRawHeaders()));
        entity.setRawQueryJson(jsonCodec.write(record.getRawQuery()));
        entity.setRawBodyJson(jsonCodec.write(record.getRawBody()));
        entity.setNormalizedEventJson(record.getNormalizedEvent() == null ? null : jsonCodec.write(record.getNormalizedEvent()));
        entity.setErrorMessage(record.getErrorMessage());
        entity.setCreatedAt(record.getCreatedAt());
        return entity;
    }

    private EventRecord toDomain(EventRecordEntity entity) {
        return new EventRecord()
                .setId(entity.getId())
                .setSourceId(entity.getSourceId())
                .setSourceKey(entity.getSourceKey())
                .setStatus(EventRecordStatus.valueOf(entity.getStatus()))
                .setEventType(entity.getEventType())
                .setEventId(entity.getExternalEventId())
                .setActor(entity.getActor())
                .setSubject(entity.getSubject())
                .setRawHeaders(jsonCodec.readMap(entity.getRawHeadersJson()))
                .setRawQuery(jsonCodec.readMap(entity.getRawQueryJson()))
                .setRawBody(jsonCodec.readUntyped(entity.getRawBodyJson()))
                .setNormalizedEvent(read(jsonCodec, entity.getNormalizedEventJson(), NormalizedEvent.class))
                .setErrorMessage(entity.getErrorMessage())
                .setCreatedAt(entity.getCreatedAt());
    }

    private static <T> T read(JsonCodec jsonCodec, String json, Class<T> type) {
        return JpaJsonSupport.read(jsonCodec, json, type);
    }
}
