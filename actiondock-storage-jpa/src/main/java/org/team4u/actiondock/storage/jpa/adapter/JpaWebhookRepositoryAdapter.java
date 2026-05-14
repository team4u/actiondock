package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.WebhookSampleRequest;
import org.team4u.actiondock.domain.port.WebhookRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.WebhookEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataWebhookEntityRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaWebhookRepositoryAdapter implements WebhookRepository {
    private final SpringDataWebhookEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaWebhookRepositoryAdapter(SpringDataWebhookEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public WebhookDefinition save(WebhookDefinition source) {
        return toDomain(repository.save(toEntity(source)));
    }

    @Override
    public Optional<WebhookDefinition> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<WebhookDefinition> findByKey(String key) {
        return repository.findByWebhookKey(key).map(this::toDomain);
    }

    @Override
    public List<WebhookDefinition> findAll() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private WebhookEntity toEntity(WebhookDefinition source) {
        WebhookEntity entity = new WebhookEntity();
        entity.setId(source.getId());
        entity.setWebhookKey(source.getKey());
        entity.setName(source.getName());
        entity.setDescription(source.getDescription());
        entity.setScope(source.getScope() == null ? null : source.getScope().name());
        entity.setRepositoryId(source.getRepositoryId());
        entity.setRepositoryWebhookId(source.getRepositoryWebhookId());
        entity.setRepositoryVersion(source.getRepositoryVersion());
        entity.setSourcePath(source.getSourcePath());
        entity.setSourceCommit(source.getSourceCommit());
        entity.setSourceDigest(source.getSourceDigest());
        entity.setSourceSyncedAt(source.getSourceSyncedAt());
        entity.setDirty(source.isDirty());
        entity.setEditable(source.isEditable());
        entity.setEnabled(source.isEnabled());
        entity.setTransportJson(jsonCodec.write(source.getTransport()));
        entity.setWebhookScriptId(source.getWebhookScriptId());
        entity.setSampleRequestJson(jsonCodec.write(source.getSampleRequest()));
        entity.setLastReceivedAt(source.getLastReceivedAt());
        entity.setCreatedAt(source.getCreatedAt());
        entity.setUpdatedAt(source.getUpdatedAt());
        return entity;
    }

    private WebhookDefinition toDomain(WebhookEntity entity) {
        return new WebhookDefinition()
                .setId(entity.getId())
                .setKey(entity.getWebhookKey())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setScope(entity.getScope() == null ? WebhookScope.PERSONAL : WebhookScope.valueOf(entity.getScope()))
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryWebhookId(entity.getRepositoryWebhookId())
                .setRepositoryVersion(entity.getRepositoryVersion())
                .setSourcePath(entity.getSourcePath())
                .setSourceCommit(entity.getSourceCommit())
                .setSourceDigest(entity.getSourceDigest())
                .setSourceSyncedAt(entity.getSourceSyncedAt())
                .setDirty(entity.isDirty())
                .setEditable(entity.isEditable())
                .setEnabled(entity.isEnabled())
                .setTransport(read(entity.getTransportJson(), org.team4u.actiondock.domain.model.WebhookTransport.class))
                .setWebhookScriptId(entity.getWebhookScriptId())
                .setSampleRequest(readSampleRequest(entity.getSampleRequestJson()))
                .setLastReceivedAt(entity.getLastReceivedAt())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private <T> T read(String json, Class<T> type) {
        return JpaJsonSupport.read(jsonCodec, json, type);
    }

    private WebhookSampleRequest readSampleRequest(String json) {
        WebhookSampleRequest sampleRequest = read(json, WebhookSampleRequest.class);
        return sampleRequest == null ? new WebhookSampleRequest() : sampleRequest;
    }
}
