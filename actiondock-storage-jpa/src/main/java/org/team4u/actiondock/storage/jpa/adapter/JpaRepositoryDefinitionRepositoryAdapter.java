package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryDefinitionEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryDefinitionRepository;

/**
 * JPA 仓库定义仓储适配器，将领域层 RepositoryDefinitionRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
@Component
public class JpaRepositoryDefinitionRepositoryAdapter
        extends AbstractJpaRepositoryAdapter<RepositoryDefinitionEntity, RepositoryDefinition, SpringDataRepositoryDefinitionRepository>
        implements RepositoryDefinitionRepository {
    public JpaRepositoryDefinitionRepositoryAdapter(SpringDataRepositoryDefinitionRepository repository) {
        super(repository);
    }

    /**
     * 将仓库定义领域对象转换为 JPA 实体。
     *
     * @param definition 仓库定义领域对象
     * @return JPA 实体
     */
    @Override
    protected RepositoryDefinitionEntity toEntity(RepositoryDefinition definition) {
        RepositoryDefinitionEntity entity = new RepositoryDefinitionEntity();
        entity.setId(definition.getId());
        entity.setName(definition.getName());
        entity.setType(definition.getType());
        entity.setPurpose(definition.getPurpose());
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
    @Override
    protected RepositoryDefinition toDomain(RepositoryDefinitionEntity entity) {
        return new RepositoryDefinition()
                .setId(entity.getId())
                .setName(entity.getName())
                .setType(entity.getType())
                .setPurpose(entity.getPurpose())
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
