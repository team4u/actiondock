package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.storage.jpa.entity.PluginRegistrationEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPluginRegistrationRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 插件注册仓储适配器，将领域层 PluginRegistryRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
@Component
public class JpaPluginRegistryRepositoryAdapter implements PluginRegistryRepository {
    private final SpringDataPluginRegistrationRepository repository;
    private final JsonCodec jsonCodec;

    public JpaPluginRegistryRepositoryAdapter(SpringDataPluginRegistrationRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public PluginRegistration save(PluginRegistration registration) {
        return toDomain(repository.save(toEntity(registration)));
    }

    @Override
    public Optional<PluginRegistration> findByPluginId(String pluginId) {
        return repository.findById(pluginId).map(this::toDomain);
    }

    @Override
    public List<PluginRegistration> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public List<PluginRegistration> findEnabled() {
        return repository.findByEnabledTrueOrderByPluginIdAsc().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteByPluginId(String pluginId) {
        repository.deleteById(pluginId);
    }

    /**
     * 将插件注册领域对象转换为 JPA 实体。
     * <p>
     * 配置 Schema、默认配置和动作列表使用 JSON 序列化存储。
     *
     * @param registration 插件注册领域对象
     * @return JPA 实体
     */
    private PluginRegistrationEntity toEntity(PluginRegistration registration) {
        PluginRegistrationEntity entity = new PluginRegistrationEntity();
        entity.setPluginId(registration.getPluginId());
        entity.setName(registration.getName());
        entity.setDescription(registration.getDescription());
        entity.setVersion(registration.getVersion());
        entity.setFileName(registration.getFileName());
        entity.setRepositoryId(registration.getRepositoryId());
        entity.setRepositoryPluginId(registration.getRepositoryPluginId());
        entity.setRepositoryVersion(registration.getRepositoryVersion());
        entity.setConfigSchemaJson(jsonCodec.write(registration.getConfigSchema()));
        entity.setDefaultConfigJson(jsonCodec.write(registration.getDefaultConfig()));
        entity.setActionsJson(jsonCodec.write(registration.getActions()));
        entity.setEnabled(registration.isEnabled());
        entity.setInstalledAt(registration.getInstalledAt());
        entity.setUpdatedAt(registration.getUpdatedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为插件注册领域对象。
     * <p>
     * JSON 字段反序列化为配置 Schema、默认配置和动作列表。
     *
     * @param entity JPA 实体
     * @return 插件注册领域对象
     */
    private PluginRegistration toDomain(PluginRegistrationEntity entity) {
        return new PluginRegistration()
                .setPluginId(entity.getPluginId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setVersion(entity.getVersion())
                .setFileName(entity.getFileName())
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryPluginId(entity.getRepositoryPluginId())
                .setRepositoryVersion(entity.getRepositoryVersion())
                .setConfigSchema(jsonCodec.readMap(entity.getConfigSchemaJson()))
                .setDefaultConfig(jsonCodec.readMap(entity.getDefaultConfigJson()))
                .setActions(jsonCodec.readList(entity.getActionsJson(), PluginActionMetadata.class))
                .setEnabled(entity.isEnabled())
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
