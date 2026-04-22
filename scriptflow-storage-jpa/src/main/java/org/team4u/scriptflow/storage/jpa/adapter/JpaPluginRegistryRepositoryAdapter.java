package org.team4u.scriptflow.storage.jpa.adapter;

import org.team4u.scriptflow.domain.model.PluginActionMetadata;
import org.team4u.scriptflow.domain.model.PluginRegistration;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.PluginRegistryRepository;
import org.team4u.scriptflow.storage.jpa.entity.PluginRegistrationEntity;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataPluginRegistrationRepository;

import java.util.List;
import java.util.Optional;

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

    private PluginRegistrationEntity toEntity(PluginRegistration registration) {
        PluginRegistrationEntity entity = new PluginRegistrationEntity();
        entity.setPluginId(registration.getPluginId());
        entity.setName(registration.getName());
        entity.setDescription(registration.getDescription());
        entity.setVersion(registration.getVersion());
        entity.setFileName(registration.getFileName());
        entity.setConfigSchemaJson(jsonCodec.write(registration.getConfigSchema()));
        entity.setDefaultConfigJson(jsonCodec.write(registration.getDefaultConfig()));
        entity.setActionsJson(jsonCodec.write(registration.getActions()));
        entity.setEnabled(registration.isEnabled());
        entity.setInstalledAt(registration.getInstalledAt());
        entity.setUpdatedAt(registration.getUpdatedAt());
        return entity;
    }

    private PluginRegistration toDomain(PluginRegistrationEntity entity) {
        return new PluginRegistration()
                .setPluginId(entity.getPluginId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setVersion(entity.getVersion())
                .setFileName(entity.getFileName())
                .setConfigSchema(jsonCodec.readMap(entity.getConfigSchemaJson()))
                .setDefaultConfig(jsonCodec.readMap(entity.getDefaultConfigJson()))
                .setActions(jsonCodec.readList(entity.getActionsJson(), PluginActionMetadata.class))
                .setEnabled(entity.isEnabled())
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
