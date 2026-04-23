package org.team4u.scriptflow.storage.jpa.adapter;

import org.team4u.scriptflow.domain.model.ConfigValue;
import org.team4u.scriptflow.domain.port.ConfigValueRepository;
import org.team4u.scriptflow.storage.jpa.entity.ConfigValueEntity;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataConfigValueRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 全局配置值仓储适配器。
 *
 * @author jay.wu
 */
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

    private ConfigValueEntity toEntity(ConfigValue configValue) {
        ConfigValueEntity entity = new ConfigValueEntity();
        entity.setKey(configValue.getKey());
        entity.setValue(configValue.getValue());
        entity.setDescription(configValue.getDescription());
        entity.setCreatedAt(configValue.getCreatedAt());
        entity.setUpdatedAt(configValue.getUpdatedAt());
        return entity;
    }

    private ConfigValue toDomain(ConfigValueEntity entity) {
        return new ConfigValue()
                .setKey(entity.getKey())
                .setValue(entity.getValue())
                .setDescription(entity.getDescription())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
