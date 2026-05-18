package org.team4u.actiondock.storage.jpa.adapter;

import jakarta.transaction.Transactional;
import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPublishedScriptRevisionRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * JPA 脚本定义仓储适配器，将领域层 ScriptRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
@Component
public class JpaScriptRepositoryAdapter implements ScriptRepository {
    private final SpringDataScriptEntityRepository repository;
    private final SpringDataPublishedScriptRevisionRepository publishedRevisionRepository;
    private final JsonCodec jsonCodec;

    public JpaScriptRepositoryAdapter(SpringDataScriptEntityRepository repository,
                                      SpringDataPublishedScriptRevisionRepository publishedRevisionRepository,
                                      JsonCodec jsonCodec) {
        this.repository = repository;
        this.publishedRevisionRepository = publishedRevisionRepository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    @Transactional
    public ScriptDefinition save(ScriptDefinition definition) {
        PublishedScriptRevision revision = definition.getPublishedRevision();
        if (revision != null) {
            revision = ensurePersistableRevision(definition, revision);
            publishedRevisionRepository.save(toRevisionEntity(revision));
            definition.setPublishedRevision(revision);
        }
        return toDomain(repository.save(toEntity(definition)));
    }

    @Override
    public Optional<ScriptDefinition> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<ScriptDefinition> findInstalledByRepositorySource(String repositoryId, String repositoryScriptId) {
        return repository.findByScopeAndRepositoryIdAndRepositoryScriptId(
                ScriptScope.REPOSITORY.name(),
                repositoryId,
                repositoryScriptId
        ).map(this::toDomain);
    }

    @Override
    public List<ScriptDefinition> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    @Transactional
    public void deleteById(String id) {
        publishedRevisionRepository.deleteByScriptId(id);
        repository.deleteById(id);
    }

    private ScriptEntity toEntity(ScriptDefinition definition) {
        ScriptEntity entity = new ScriptEntity();
        entity.setId(definition.getId());
        entity.setName(definition.getName());
        entity.setType(definition.getType().name());
        entity.setPackaging(definition.getPackaging().name());
        entity.setSource(definition.getSource());
        entity.setPythonRequirements(definition.getPythonRequirements());
        entity.setInputSchemaJson(jsonCodec.write(definition.getInputSchema()));
        entity.setOutputSchemaJson(jsonCodec.write(definition.getOutputSchema()));
        entity.setVersionValue(definition.getVersion());
        entity.setPublishedRevisionId(definition.getPublishedRevisionId());
        entity.setPublishedAt(definition.getPublishedAt());
        entity.setScope(definition.getScope().name());
        entity.setRepositoryId(definition.getRepositoryId());
        entity.setRepositoryScriptId(definition.getRepositoryScriptId());
        entity.setRepositoryVersion(definition.getRepositoryVersion());
        entity.setSourcePath(definition.getSourcePath());
        entity.setSourceCommit(definition.getSourceCommit());
        entity.setSourceDigest(definition.getSourceDigest());
        entity.setSourceSyncedAt(definition.getSourceSyncedAt());
        entity.setDirty(definition.isDirty());
        entity.setEditable(definition.isEditable());
        entity.setOwner(definition.getOwner());
        entity.setDescription(definition.getDescription());
        entity.setTagsJson(jsonCodec.write(definition.getTags()));
        entity.setScriptDependenciesJson(jsonCodec.write(definition.getScriptDependencies()));
        entity.setPluginDependenciesJson(jsonCodec.write(definition.getPluginDependencies()));
        entity.setAiDependenciesJson(jsonCodec.write(definition.getAiDependencies()));
        entity.setCreatedAt(definition.getCreatedAt());
        entity.setUpdatedAt(definition.getUpdatedAt());
        return entity;
    }

    private ScriptDefinition toDomain(ScriptEntity entity) {
        return new ScriptDefinition()
                .setId(entity.getId())
                .setName(entity.getName())
                .setType(ScriptType.valueOf(entity.getType()))
                .setPackaging(entity.getPackaging() == null ? ScriptPackaging.TOOL : ScriptPackaging.valueOf(entity.getPackaging()))
                .setSource(entity.getSource())
                .setPythonRequirements(entity.getPythonRequirements())
                .setInputSchema(jsonCodec.readMap(entity.getInputSchemaJson()))
                .setOutputSchema(jsonCodec.readMap(entity.getOutputSchemaJson()))
                .setVersion(entity.getVersionValue())
                .setPublishedRevisionId(entity.getPublishedRevisionId())
                .setPublishedAt(entity.getPublishedAt())
                .setPublishedRevision(resolvePublishedRevision(entity))
                .setScope(entity.getScope() == null ? ScriptScope.PERSONAL : ScriptScope.valueOf(entity.getScope()))
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryScriptId(entity.getRepositoryScriptId())
                .setRepositoryVersion(entity.getRepositoryVersion())
                .setSourcePath(entity.getSourcePath())
                .setSourceCommit(entity.getSourceCommit())
                .setSourceDigest(entity.getSourceDigest())
                .setSourceSyncedAt(entity.getSourceSyncedAt())
                .setDirty(entity.isDirty())
                .setEditable(entity.isEditable())
                .setOwner(entity.getOwner())
                .setDescription(entity.getDescription())
                .setTags(jsonCodec.readList(entity.getTagsJson(), String.class))
                .setScriptDependencies(jsonCodec.readList(entity.getScriptDependenciesJson(), ScriptDependency.class))
                .setPluginDependencies(jsonCodec.readList(entity.getPluginDependenciesJson(), PluginDependency.class))
                .setAiDependencies(jsonCodec.readList(entity.getAiDependenciesJson(), AiDependency.class))
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private PublishedScriptRevision resolvePublishedRevision(ScriptEntity entity) {
        if (entity.getPublishedRevisionId() == null || entity.getPublishedRevisionId().isBlank()) {
            return null;
        }
        return publishedRevisionRepository.findById(entity.getPublishedRevisionId())
                .map(this::toRevisionDomain)
                .orElse(null);
    }

    private PublishedScriptRevision ensurePersistableRevision(ScriptDefinition definition, PublishedScriptRevision revision) {
        PublishedScriptRevision normalized = revision.copy();
        if (normalized.getScriptId() == null || normalized.getScriptId().isBlank()) {
            normalized.setScriptId(definition.getId());
        }
        if (normalized.getVersion() == null) {
            normalized.setVersion(definition.getVersion());
        }
        if (normalized.getId() == null || normalized.getId().isBlank()) {
            normalized.setId(normalized.getScriptId() + ":published:" + normalized.getVersion());
        }
        if (normalized.getPublishedAt() == null) {
            LocalDateTime publishedAt = definition.getPublishedAt();
            if (publishedAt == null) {
                publishedAt = definition.getUpdatedAt() == null ? definition.getCreatedAt() : definition.getUpdatedAt();
            }
            normalized.setPublishedAt(publishedAt);
        }
        return normalized;
    }

    private org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity toRevisionEntity(PublishedScriptRevision revision) {
        org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity entity =
                new org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity();
        entity.setId(revision.getId());
        entity.setScriptId(revision.getScriptId());
        entity.setVersionValue(revision.getVersion());
        entity.setPublishedAt(revision.getPublishedAt());
        entity.setName(revision.getName());
        entity.setType(revision.getType().name());
        entity.setPackaging(revision.getPackaging().name());
        entity.setSource(revision.getSource());
        entity.setPythonRequirements(revision.getPythonRequirements());
        entity.setInputSchemaJson(jsonCodec.write(revision.getInputSchema()));
        entity.setOutputSchemaJson(jsonCodec.write(revision.getOutputSchema()));
        entity.setOwner(revision.getOwner());
        entity.setDescription(revision.getDescription());
        entity.setTagsJson(jsonCodec.write(revision.getTags()));
        entity.setScriptDependenciesJson(jsonCodec.write(revision.getScriptDependencies()));
        entity.setPluginDependenciesJson(jsonCodec.write(revision.getPluginDependencies()));
        entity.setAiDependenciesJson(jsonCodec.write(revision.getAiDependencies()));
        return entity;
    }

    private PublishedScriptRevision toRevisionDomain(org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity entity) {
        return new PublishedScriptRevision()
                .setId(entity.getId())
                .setScriptId(entity.getScriptId())
                .setVersion(entity.getVersionValue())
                .setPublishedAt(entity.getPublishedAt())
                .setName(entity.getName())
                .setType(entity.getType() == null ? ScriptType.GROOVY : ScriptType.valueOf(entity.getType()))
                .setPackaging(entity.getPackaging() == null ? ScriptPackaging.TOOL : ScriptPackaging.valueOf(entity.getPackaging()))
                .setSource(entity.getSource())
                .setPythonRequirements(entity.getPythonRequirements())
                .setInputSchema(jsonCodec.readMap(entity.getInputSchemaJson()))
                .setOutputSchema(jsonCodec.readMap(entity.getOutputSchemaJson()))
                .setOwner(entity.getOwner())
                .setDescription(entity.getDescription())
                .setTags(jsonCodec.readList(entity.getTagsJson(), String.class))
                .setScriptDependencies(jsonCodec.readList(entity.getScriptDependenciesJson(), ScriptDependency.class))
                .setPluginDependencies(jsonCodec.readList(entity.getPluginDependenciesJson(), PluginDependency.class))
                .setAiDependencies(jsonCodec.readList(entity.getAiDependenciesJson(), AiDependency.class));
    }
}
