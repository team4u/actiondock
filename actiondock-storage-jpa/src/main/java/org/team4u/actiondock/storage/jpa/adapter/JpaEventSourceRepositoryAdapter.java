package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.EventSourceEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataEventSourceEntityRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaEventSourceRepositoryAdapter implements EventSourceRepository {
    private final SpringDataEventSourceEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaEventSourceRepositoryAdapter(SpringDataEventSourceEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public EventSourceDefinition save(EventSourceDefinition source) {
        return toDomain(repository.save(toEntity(source)));
    }

    @Override
    public Optional<EventSourceDefinition> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<EventSourceDefinition> findByKey(String key) {
        return repository.findBySourceKey(key).map(this::toDomain);
    }

    @Override
    public List<EventSourceDefinition> findAll() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private EventSourceEntity toEntity(EventSourceDefinition source) {
        EventSourceEntity entity = new EventSourceEntity();
        entity.setId(source.getId());
        entity.setSourceKey(source.getKey());
        entity.setName(source.getName());
        entity.setDescription(source.getDescription());
        entity.setScope(source.getScope() == null ? null : source.getScope().name());
        entity.setRepositoryId(source.getRepositoryId());
        entity.setRepositoryEventSourceId(source.getRepositoryEventSourceId());
        entity.setRepositoryVersion(source.getRepositoryVersion());
        entity.setSourcePath(source.getSourcePath());
        entity.setSourceCommit(source.getSourceCommit());
        entity.setSourceDigest(source.getSourceDigest());
        entity.setSourceSyncedAt(source.getSourceSyncedAt());
        entity.setDirty(source.isDirty());
        entity.setEditable(source.isEditable());
        entity.setEnabled(source.isEnabled());
        entity.setTransportJson(jsonCodec.write(source.getTransport()));
        entity.setAuthJson(source.getAuth() == null ? null : jsonCodec.write(source.getAuth()));
        entity.setNormalizationProcessorJson(source.getNormalizationProcessor() == null
                ? null
                : jsonCodec.write(source.getNormalizationProcessor()));
        entity.setSampleContextJson(jsonCodec.write(source.getSampleContext()));
        entity.setLastReceivedAt(source.getLastReceivedAt());
        entity.setCreatedAt(source.getCreatedAt());
        entity.setUpdatedAt(source.getUpdatedAt());
        return entity;
    }

    private EventSourceDefinition toDomain(EventSourceEntity entity) {
        return new EventSourceDefinition()
                .setId(entity.getId())
                .setKey(entity.getSourceKey())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setScope(entity.getScope() == null ? EventSourceScope.PERSONAL : EventSourceScope.valueOf(entity.getScope()))
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryEventSourceId(entity.getRepositoryEventSourceId())
                .setRepositoryVersion(entity.getRepositoryVersion())
                .setSourcePath(entity.getSourcePath())
                .setSourceCommit(entity.getSourceCommit())
                .setSourceDigest(entity.getSourceDigest())
                .setSourceSyncedAt(entity.getSourceSyncedAt())
                .setDirty(entity.isDirty())
                .setEditable(entity.isEditable())
                .setEnabled(entity.isEnabled())
                .setTransport(read(entity.getTransportJson(), org.team4u.actiondock.domain.model.EventSourceTransport.class))
                .setAuth(read(entity.getAuthJson(), org.team4u.actiondock.domain.model.EventSourceAuthConfig.class))
                .setNormalizationProcessor(read(entity.getNormalizationProcessorJson(), org.team4u.actiondock.domain.model.ProcessorDefinition.class))
                .setSampleContext(jsonCodec.readMap(entity.getSampleContextJson()))
                .setLastReceivedAt(entity.getLastReceivedAt())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private <T> T read(String json, Class<T> type) {
        return JpaJsonSupport.read(jsonCodec, json, type);
    }
}
