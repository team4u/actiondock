package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiToolsetEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiToolsetRepository;

import java.util.List;
import java.util.Optional;

public class JpaAiToolsetRepositoryAdapter implements AiToolsetRepository {
    private final SpringDataAiToolsetRepository repository;
    private final JsonCodec jsonCodec;

    public JpaAiToolsetRepositoryAdapter(SpringDataAiToolsetRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public AiToolset save(AiToolset toolset) {
        return toDomain(repository.save(toEntity(toolset)));
    }

    @Override
    public Optional<AiToolset> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<AiToolset> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private AiToolsetEntity toEntity(AiToolset toolset) {
        AiToolsetEntity entity = new AiToolsetEntity();
        entity.setId(toolset.getId());
        entity.setName(toolset.getName());
        entity.setDescription(toolset.getDescription());
        entity.setToolNamesJson(jsonCodec.write(toolset.getToolNames()));
        entity.setMaxPermission(toolset.getMaxPermission().name());
        entity.setEnabled(toolset.isEnabled());
        entity.setCreatedAt(toolset.getCreatedAt());
        entity.setUpdatedAt(toolset.getUpdatedAt());
        return entity;
    }

    private AiToolset toDomain(AiToolsetEntity entity) {
        return new AiToolset()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setToolNames(jsonCodec.readList(entity.getToolNamesJson(), String.class))
                .setMaxPermission(entity.getMaxPermission() == null ? AiToolPermission.READ_ONLY : AiToolPermission.valueOf(entity.getMaxPermission()))
                .setEnabled(entity.isEnabled())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
