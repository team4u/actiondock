package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.ExecutionPresetEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionPresetEntityRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 执行参数预设备储适配器，将领域层 ExecutionPresetRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
public class JpaExecutionPresetRepositoryAdapter implements ExecutionPresetRepository {

    private final SpringDataExecutionPresetEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaExecutionPresetRepositoryAdapter(SpringDataExecutionPresetEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public ExecutionPreset save(ExecutionPreset preset) {
        return toDomain(repository.save(toEntity(preset)));
    }

    @Override
    public Optional<ExecutionPreset> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<ExecutionPreset> findByScriptId(String scriptId) {
        return repository.findByScriptIdOrderByCreatedAtDesc(scriptId).stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    @Override
    public void deleteByScriptId(String scriptId) {
        repository.deleteAllByScriptId(scriptId);
    }

    private ExecutionPresetEntity toEntity(ExecutionPreset preset) {
        ExecutionPresetEntity entity = new ExecutionPresetEntity();
        entity.setId(preset.getId());
        entity.setScriptId(preset.getScriptId());
        entity.setName(preset.getName());
        entity.setInputJson(jsonCodec.write(preset.getInput()));
        entity.setCreatedAt(preset.getCreatedAt());
        entity.setUpdatedAt(preset.getUpdatedAt());
        return entity;
    }

    private ExecutionPreset toDomain(ExecutionPresetEntity entity) {
        return new ExecutionPreset()
                .setId(entity.getId())
                .setScriptId(entity.getScriptId())
                .setName(entity.getName())
                .setInput(jsonCodec.readMap(entity.getInputJson()))
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
