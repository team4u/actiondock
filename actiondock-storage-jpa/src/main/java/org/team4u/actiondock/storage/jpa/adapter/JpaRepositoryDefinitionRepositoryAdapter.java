package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryDefinitionEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryDefinitionRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 仓库定义仓储适配器，将领域层 RepositoryDefinitionRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
public class JpaRepositoryDefinitionRepositoryAdapter implements RepositoryDefinitionRepository {
    private final SpringDataRepositoryDefinitionRepository repository;

    public JpaRepositoryDefinitionRepositoryAdapter(SpringDataRepositoryDefinitionRepository repository) {
        this.repository = repository;
    }

    @Override
    public RepositoryDefinition save(RepositoryDefinition registryDefinition) {
        return toDomain(repository.save(toEntity(registryDefinition)));
    }

    @Override
    public Optional<RepositoryDefinition> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<RepositoryDefinition> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    /**
     * 将仓库定义领域对象转换为 JPA 实体。
     *
     * @param definition 仓库定义领域对象
     * @return JPA 实体
     */
    private RepositoryDefinitionEntity toEntity(RepositoryDefinition definition) {
        RepositoryDefinitionEntity entity = new RepositoryDefinitionEntity();
        entity.setId(definition.getId());
        entity.setName(definition.getName());
        entity.setAlias(definition.getAlias());
        entity.setType(definition.getType());
        entity.setUrl(definition.getUrl());
        entity.setBranch(definition.getBranch());
        entity.setEnabled(definition.isEnabled());
        entity.setTrustLevel(definition.getTrustLevel());
        entity.setDescription(definition.getDescription());
        entity.setLastSyncedAt(definition.getLastSyncedAt());
        entity.setCreatedAt(definition.getCreatedAt());
        entity.setUpdatedAt(definition.getUpdatedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为仓库定义领域对象。
     *
     * @param entity JPA 实体
     * @return 仓库定义领域对象
     */
    private RepositoryDefinition toDomain(RepositoryDefinitionEntity entity) {
        return new RepositoryDefinition()
                .setId(entity.getId())
                .setName(entity.getName())
                .setAlias(entity.getAlias())
                .setType(entity.getType())
                .setUrl(entity.getUrl())
                .setBranch(entity.getBranch())
                .setEnabled(entity.isEnabled())
                .setTrustLevel(entity.getTrustLevel())
                .setDescription(entity.getDescription())
                .setLastSyncedAt(entity.getLastSyncedAt())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
