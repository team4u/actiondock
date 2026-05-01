package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventDispatchStatus;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.EventDispatchEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataEventDispatchEntityRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaEventDispatchRepositoryAdapter implements EventDispatchRepository {
    private final SpringDataEventDispatchEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaEventDispatchRepositoryAdapter(SpringDataEventDispatchEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public EventDispatchRecord save(EventDispatchRecord record) {
        return toDomain(repository.save(toEntity(record)));
    }

    @Override
    public Optional<EventDispatchRecord> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<EventDispatchRecord> findByTriggerIdAndIdempotencyKey(String triggerId, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return Optional.empty();
        }
        return repository.findByTriggerIdAndIdempotencyKey(triggerId, idempotencyKey).map(this::toDomain);
    }

    @Override
    public List<EventDispatchRecord> findByEventId(String eventId) {
        return repository.findByEventIdOrderByCreatedAtAsc(eventId).stream().map(this::toDomain).toList();
    }

    @Override
    public List<EventDispatchRecord> findByTriggerId(String triggerId) {
        return repository.findByTriggerIdOrderByCreatedAtDesc(triggerId).stream().map(this::toDomain).toList();
    }

    private EventDispatchEntity toEntity(EventDispatchRecord record) {
        EventDispatchEntity entity = new EventDispatchEntity();
        entity.setId(record.getId());
        entity.setEventId(record.getEventId());
        entity.setSourceId(record.getSourceId());
        entity.setTriggerId(record.getTriggerId());
        entity.setTargetScriptId(record.getTargetScriptId());
        entity.setStatus(record.getStatus().name());
        entity.setFilterMatched(record.getFilterMatched());
        entity.setIdempotencyKey(record.getIdempotencyKey());
        entity.setMappedInputJson(jsonCodec.write(record.getMappedInput()));
        entity.setExecutionId(record.getExecutionId());
        entity.setExecutionStatus(record.getExecutionStatus() == null ? null : record.getExecutionStatus().name());
        entity.setErrorMessage(record.getErrorMessage());
        entity.setCreatedAt(record.getCreatedAt());
        entity.setUpdatedAt(record.getUpdatedAt());
        return entity;
    }

    private EventDispatchRecord toDomain(EventDispatchEntity entity) {
        return new EventDispatchRecord()
                .setId(entity.getId())
                .setEventId(entity.getEventId())
                .setSourceId(entity.getSourceId())
                .setTriggerId(entity.getTriggerId())
                .setTargetScriptId(entity.getTargetScriptId())
                .setStatus(EventDispatchStatus.valueOf(entity.getStatus()))
                .setFilterMatched(entity.getFilterMatched())
                .setIdempotencyKey(entity.getIdempotencyKey())
                .setMappedInput(jsonCodec.readMap(entity.getMappedInputJson()))
                .setExecutionId(entity.getExecutionId())
                .setExecutionStatus(entity.getExecutionStatus() == null ? null : ExecutionStatus.valueOf(entity.getExecutionStatus()))
                .setErrorMessage(entity.getErrorMessage())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
