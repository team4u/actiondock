package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.EventTriggerEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataEventTriggerEntityRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaEventTriggerRepositoryAdapter implements EventTriggerRepository {
    private final SpringDataEventTriggerEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaEventTriggerRepositoryAdapter(SpringDataEventTriggerEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public EventTrigger save(EventTrigger trigger) {
        return toDomain(repository.save(toEntity(trigger)));
    }

    @Override
    public Optional<EventTrigger> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<EventTrigger> findAll() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(this::toDomain).toList();
    }

    @Override
    public List<EventTrigger> findBySourceId(String sourceId) {
        return repository.findBySourceIdOrderByCreatedAtDesc(sourceId).stream().map(this::toDomain).toList();
    }

    @Override
    public List<EventTrigger> findBySourceIdAndEnabled(String sourceId, boolean enabled) {
        return repository.findBySourceIdAndEnabledOrderByCreatedAtDesc(sourceId, enabled).stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private EventTriggerEntity toEntity(EventTrigger trigger) {
        EventTriggerEntity entity = new EventTriggerEntity();
        entity.setId(trigger.getId());
        entity.setName(trigger.getName());
        entity.setDescription(trigger.getDescription());
        entity.setEnabled(trigger.isEnabled());
        entity.setSourceId(trigger.getSourceId());
        entity.setTargetScriptId(trigger.getTargetScriptId());
        entity.setFilterProcessorJson(trigger.getFilterProcessor() == null ? null : jsonCodec.write(trigger.getFilterProcessor()));
        entity.setIdempotencyProcessorJson(trigger.getIdempotencyProcessor() == null ? null : jsonCodec.write(trigger.getIdempotencyProcessor()));
        entity.setInputProcessorJson(trigger.getInputProcessor() == null ? null : jsonCodec.write(trigger.getInputProcessor()));
        entity.setSubmitMode(trigger.getSubmitMode().name());
        entity.setResponseView(trigger.getResponseView());
        entity.setLastEventId(trigger.getLastEventId());
        entity.setLastTriggeredAt(trigger.getLastTriggeredAt());
        entity.setLastExecutionId(trigger.getLastExecutionId());
        entity.setLastExecutionStatus(trigger.getLastExecutionStatus() == null ? null : trigger.getLastExecutionStatus().name());
        entity.setCreatedAt(trigger.getCreatedAt());
        entity.setUpdatedAt(trigger.getUpdatedAt());
        return entity;
    }

    private EventTrigger toDomain(EventTriggerEntity entity) {
        return new EventTrigger()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setEnabled(entity.isEnabled())
                .setSourceId(entity.getSourceId())
                .setTargetScriptId(entity.getTargetScriptId())
                .setFilterProcessor(read(entity.getFilterProcessorJson(), org.team4u.actiondock.domain.model.ProcessorDefinition.class))
                .setIdempotencyProcessor(read(entity.getIdempotencyProcessorJson(), org.team4u.actiondock.domain.model.ProcessorDefinition.class))
                .setInputProcessor(read(entity.getInputProcessorJson(), org.team4u.actiondock.domain.model.ProcessorDefinition.class))
                .setSubmitMode(entity.getSubmitMode() == null ? SubmitMode.ASYNC : SubmitMode.valueOf(entity.getSubmitMode()))
                .setResponseView(entity.getResponseView())
                .setLastEventId(entity.getLastEventId())
                .setLastTriggeredAt(entity.getLastTriggeredAt())
                .setLastExecutionId(entity.getLastExecutionId())
                .setLastExecutionStatus(entity.getLastExecutionStatus() == null ? null : ExecutionStatus.valueOf(entity.getLastExecutionStatus()))
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private <T> T read(String json, Class<T> type) {
        return json == null || json.isBlank() ? null : jsonCodec.read(json, type);
    }
}
