package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiToolsetEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiToolsetRepository;

import java.util.Map;

@Component
public class JpaAiToolsetRepositoryAdapter
        extends AbstractJpaRepositoryAdapter<AiToolsetEntity, AiToolset, SpringDataAiToolsetRepository>
        implements AiToolsetRepository {

    private final JsonCodec jsonCodec;

    public JpaAiToolsetRepositoryAdapter(SpringDataAiToolsetRepository repository, JsonCodec jsonCodec) {
        super(repository);
        this.jsonCodec = jsonCodec;
    }

    @Override
    protected AiToolsetEntity toEntity(AiToolset toolset) {
        AiToolsetEntity entity = new AiToolsetEntity();
        entity.setId(toolset.getId());
        entity.setName(toolset.getName());
        entity.setDescription(toolset.getDescription());
        entity.setToolNamesJson(jsonCodec.write(toolset.getToolNames()));
        entity.setToolOptionsJson(jsonCodec.write(toolset.getToolOptions()));
        entity.setMaxPermission(toolset.getMaxPermission().name());
        entity.setEnabled(toolset.isEnabled());
        entity.setCreatedAt(toolset.getCreatedAt());
        entity.setUpdatedAt(toolset.getUpdatedAt());
        return entity;
    }

    @Override
    protected AiToolset toDomain(AiToolsetEntity entity) {
        return new AiToolset()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setToolNames(jsonCodec.readList(entity.getToolNamesJson(), String.class))
                .setToolOptions(readToolOptions(entity.getToolOptionsJson()))
                .setMaxPermission(entity.getMaxPermission() == null ? AiToolPermission.READ_ONLY : AiToolPermission.valueOf(entity.getMaxPermission()))
                .setEnabled(entity.isEnabled())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private Map<String, Map<String, Object>> readToolOptions(String json) {
        return JpaJsonSupport.readToolOptions(jsonCodec, json);
    }
}
