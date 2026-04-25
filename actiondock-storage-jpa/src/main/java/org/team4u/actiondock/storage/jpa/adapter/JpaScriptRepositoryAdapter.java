package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 脚本定义仓储适配器，将领域层 ScriptRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
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

    /**
     * 将脚本定义领域对象转换为 JPA 实体。
     * <p>
     * 将已发布快照平铺到实体的 published 前缀字段，Schema 使用 JSON 序列化。
     *
     * @param definition 脚本定义领域对象
     * @return JPA 实体
     */
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
        entity.setScope(definition.getScope().name());
        entity.setRepositoryId(definition.getRepositoryId());
        entity.setRepositoryToolId(definition.getRepositoryToolId());
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
        entity.setPluginDependenciesJson(jsonCodec.write(definition.getPluginDependencies()));
        entity.setCreatedAt(definition.getCreatedAt());
        entity.setUpdatedAt(definition.getUpdatedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为脚本定义领域对象。
     * <p>
     * 从 published 前缀字段重建已发布快照，Schema 使用 JSON 反序列化。
     *
     * @param entity JPA 实体
     * @return 脚本定义领域对象
     */
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
                .setScope(entity.getScope() == null ? ScriptScope.PERSONAL : ScriptScope.valueOf(entity.getScope()))
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryToolId(entity.getRepositoryToolId())
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
                .setPluginDependencies(jsonCodec.readList(entity.getPluginDependenciesJson(), PluginDependency.class))
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    /**
     * 从 JPA 实体的 published 字段重建已发布快照。
     *
     * @param entity JPA 实体
     * @return 已发布快照，所有 published 字段为空时返回 null
     */
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
