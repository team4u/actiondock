package org.team4u.scriptflow.storage.jpa.adapter;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.storage.jpa.entity.ScriptEntity;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.util.List;
import java.util.Optional;

public class JpaScriptRepositoryAdapter implements ScriptRepository {
    private final SpringDataScriptEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaScriptRepositoryAdapter(SpringDataScriptEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public ScriptDefinition save(ScriptDefinition definition) {
        return toDomain(repository.save(toEntity(definition)));
    }

    @Override
    public Optional<ScriptDefinition> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<ScriptDefinition> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private ScriptEntity toEntity(ScriptDefinition definition) {
        ScriptEntity entity = new ScriptEntity();
        PublishedScriptSnapshot publishedSnapshot = definition.getPublishedSnapshot();
        entity.setId(definition.getId());
        entity.setName(definition.getName());
        entity.setType(definition.getType().name());
        entity.setSource(definition.getSource());
        entity.setInputSchemaJson(jsonCodec.write(definition.getInputSchema()));
        entity.setOutputSchemaJson(jsonCodec.write(definition.getOutputSchema()));
        entity.setPublishedName(publishedSnapshot == null ? null : publishedSnapshot.getName());
        entity.setPublishedType(publishedSnapshot == null ? null : publishedSnapshot.getType().name());
        entity.setPublishedSource(publishedSnapshot == null ? null : publishedSnapshot.getSource());
        entity.setPublishedInputSchemaJson(publishedSnapshot == null ? null : jsonCodec.write(publishedSnapshot.getInputSchema()));
        entity.setPublishedOutputSchemaJson(publishedSnapshot == null ? null : jsonCodec.write(publishedSnapshot.getOutputSchema()));
        entity.setStatus(definition.getStatus().name());
        entity.setVersionValue(definition.getVersion());
        entity.setCreatedAt(definition.getCreatedAt());
        entity.setUpdatedAt(definition.getUpdatedAt());
        return entity;
    }

    private ScriptDefinition toDomain(ScriptEntity entity) {
        return new ScriptDefinition()
                .setId(entity.getId())
                .setName(entity.getName())
                .setType(ScriptType.valueOf(entity.getType()))
                .setSource(entity.getSource())
                .setInputSchema(jsonCodec.readMap(entity.getInputSchemaJson()))
                .setOutputSchema(jsonCodec.readMap(entity.getOutputSchemaJson()))
                .setPublishedSnapshot(toSnapshot(entity))
                .setStatus(ScriptStatus.valueOf(entity.getStatus()))
                .setVersion(entity.getVersionValue())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private PublishedScriptSnapshot toSnapshot(ScriptEntity entity) {
        if (entity.getPublishedType() == null && entity.getPublishedSource() == null && entity.getPublishedName() == null
                && entity.getPublishedInputSchemaJson() == null && entity.getPublishedOutputSchemaJson() == null) {
            return null;
        }

        return new PublishedScriptSnapshot()
                .setName(entity.getPublishedName())
                .setType(entity.getPublishedType() == null ? ScriptType.GROOVY : ScriptType.valueOf(entity.getPublishedType()))
                .setSource(entity.getPublishedSource())
                .setInputSchema(jsonCodec.readMap(entity.getPublishedInputSchemaJson()))
                .setOutputSchema(jsonCodec.readMap(entity.getPublishedOutputSchemaJson()));
    }
}
