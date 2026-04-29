package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.storage.jpa.entity.ConfigValueEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataConfigValueRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 全局配置值仓储适配器。
 *
 * @author jay.wu
 */
@Component
public class JpaConfigValueRepositoryAdapter implements ConfigValueRepository {
    private final SpringDataConfigValueRepository repository;

    public JpaConfigValueRepositoryAdapter(SpringDataConfigValueRepository repository) {
        this.repository = repository;
    }

    @Override
    public ConfigValue save(ConfigValue configValue) {
        return toDomain(repository.save(toEntity(configValue)));
    }

    @Override
    public Optional<ConfigValue> findByKey(String key) {
        return repository.findById(key).map(this::toDomain);
    }

    @Override
    public List<ConfigValue> findAll() {
        return repository.findAllByOrderByKeyAsc().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteByKey(String key) {
        repository.deleteById(key);
    }

    /**
     * 将配置值领域对象转换为 JPA 实体。
     *
     * @param configValue 配置值领域对象
     * @return JPA 实体
     */
    private ConfigValueEntity toEntity(ConfigValue configValue) {
        ConfigValueEntity entity = new ConfigValueEntity();
        entity.setKey(configValue.getKey());
        entity.setValue(configValue.getValue());
        entity.setDescription(configValue.getDescription());
        entity.setSecret(configValue.isSecret());
        entity.setRepositoryId(configValue.getRepositoryId());
        entity.setRepositoryToolId(configValue.getRepositoryToolId());
        entity.setRepositoryVersion(configValue.getRepositoryVersion());
        entity.setPublishMode(configValue.getPublishMode());
        entity.setManaged(configValue.isManaged());
        entity.setOverridden(configValue.isOverridden());
        entity.setCreatedAt(configValue.getCreatedAt());
        entity.setUpdatedAt(configValue.getUpdatedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为配置值领域对象。
     *
     * @param entity JPA 实体
     * @return 配置值领域对象
     */
    private ConfigValue toDomain(ConfigValueEntity entity) {
        return new ConfigValue()
                .setKey(entity.getKey())
                .setValue(entity.getValue())
                .setDescription(entity.getDescription())
                .setSecret(entity.isSecret())
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryToolId(entity.getRepositoryToolId())
                .setRepositoryVersion(entity.getRepositoryVersion())
                .setPublishMode(entity.getPublishMode())
                .setManaged(entity.isManaged())
                .setOverridden(entity.isOverridden())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
