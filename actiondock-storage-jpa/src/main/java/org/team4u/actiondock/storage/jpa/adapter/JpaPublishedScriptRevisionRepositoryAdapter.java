package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PublishedScriptRevisionRepository;
import org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPublishedScriptRevisionRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaPublishedScriptRevisionRepositoryAdapter implements PublishedScriptRevisionRepository {
    private final SpringDataPublishedScriptRevisionRepository repository;
    private final JsonCodec jsonCodec;

    public JpaPublishedScriptRevisionRepositoryAdapter(SpringDataPublishedScriptRevisionRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public PublishedScriptRevision save(PublishedScriptRevision revision) {
        return toDomain(repository.save(toEntity(revision)));
    }

    @Override
    public Optional<PublishedScriptRevision> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<PublishedScriptRevision> findByScriptId(String scriptId) {
        return repository.findByScriptIdOrderByVersionValueDesc(scriptId).stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteByScriptId(String scriptId) {
        repository.deleteByScriptId(scriptId);
    }

    private PublishedScriptRevisionEntity toEntity(PublishedScriptRevision revision) {
        PublishedScriptRevisionEntity entity = new PublishedScriptRevisionEntity();
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

    private PublishedScriptRevision toDomain(PublishedScriptRevisionEntity entity) {
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
