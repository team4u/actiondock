package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.SharedStateEntry;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.SharedStateRepository;
import org.team4u.actiondock.storage.jpa.entity.SharedStateEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataSharedStateRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * JPA 共享状态仓储适配器。
 *
 * @author jay.wu
 */
@Component
public class JpaSharedStateRepositoryAdapter implements SharedStateRepository {
    private static final String ID_SEPARATOR = "\u0000";

    private final SpringDataSharedStateRepository repository;
    private final JsonCodec jsonCodec;

    public JpaSharedStateRepositoryAdapter(SpringDataSharedStateRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public SharedStateEntry save(SharedStateEntry entry) {
        return toDomain(repository.save(toEntity(entry)));
    }

    @Override
    public Optional<SharedStateEntry> findByNamespaceAndKey(String namespace, String key) {
        return repository.findByNamespaceAndEntryKey(namespace, key).map(this::toDomain);
    }

    @Override
    public List<SharedStateEntry> findByNamespace(String namespace) {
        return repository.findByNamespaceOrderByEntryKeyAsc(namespace).stream().map(this::toDomain).toList();
    }

    @Override
    public List<SharedStateEntry> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public boolean compareAndSet(SharedStateEntry entry, Long expectedVersion) {
        return repository.compareAndSet(
                entry.getNamespace(),
                entry.getKey(),
                expectedVersion,
                entry.getVersion(),
                jsonCodec.write(entry.getValue()),
                entry.isSecret(),
                entry.getExpiresAt(),
                entry.getUpdatedAt(),
                entry.getLastWriterScriptId(),
                entry.getLastWriterExecutionId()
        ) > 0;
    }

    @Override
    public void deleteByNamespaceAndKey(String namespace, String key) {
        repository.findByNamespaceAndEntryKey(namespace, key).ifPresent(repository::delete);
    }

    @Override
    public long deleteExpired(LocalDateTime now) {
        return repository.deleteExpired(now);
    }

    @Override
    public long deleteExpired(String namespace, LocalDateTime now) {
        return repository.deleteExpiredByNamespace(namespace, now);
    }

    private SharedStateEntity toEntity(SharedStateEntry entry) {
        SharedStateEntity entity = new SharedStateEntity();
        entity.setId(compositeId(entry.getNamespace(), entry.getKey()));
        entity.setNamespace(entry.getNamespace());
        entity.setEntryKey(entry.getKey());
        entity.setValueJson(jsonCodec.write(entry.getValue()));
        entity.setSecret(entry.isSecret());
        entity.setVersionValue(entry.getVersion());
        entity.setExpiresAt(entry.getExpiresAt());
        entity.setCreatedAt(entry.getCreatedAt());
        entity.setUpdatedAt(entry.getUpdatedAt());
        entity.setLastWriterScriptId(entry.getLastWriterScriptId());
        entity.setLastWriterExecutionId(entry.getLastWriterExecutionId());
        return entity;
    }

    private SharedStateEntry toDomain(SharedStateEntity entity) {
        return new SharedStateEntry()
                .setNamespace(entity.getNamespace())
                .setKey(entity.getEntryKey())
                .setValue(jsonCodec.readUntyped(entity.getValueJson()))
                .setSecret(entity.isSecret())
                .setVersion(entity.getVersionValue())
                .setExpiresAt(entity.getExpiresAt())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt())
                .setLastWriterScriptId(entity.getLastWriterScriptId())
                .setLastWriterExecutionId(entity.getLastWriterExecutionId());
    }

    private static String compositeId(String namespace, String key) {
        return namespace + ID_SEPARATOR + key;
    }
}
