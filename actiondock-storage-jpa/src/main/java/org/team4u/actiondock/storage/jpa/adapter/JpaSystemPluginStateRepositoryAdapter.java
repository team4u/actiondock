package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.SystemPluginState;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;
import org.team4u.actiondock.storage.jpa.entity.SystemPluginStateEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataSystemPluginStateRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaSystemPluginStateRepositoryAdapter implements SystemPluginStateRepository {
    private final SpringDataSystemPluginStateRepository repository;

    public JpaSystemPluginStateRepositoryAdapter(SpringDataSystemPluginStateRepository repository) {
        this.repository = repository;
    }

    @Override
    public SystemPluginState save(SystemPluginState state) {
        return toDomain(repository.save(toEntity(state)));
    }

    @Override
    public Optional<SystemPluginState> findByPluginId(String pluginId) {
        return repository.findById(pluginId).map(this::toDomain);
    }

    @Override
    public List<SystemPluginState> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    private SystemPluginStateEntity toEntity(SystemPluginState state) {
        SystemPluginStateEntity entity = new SystemPluginStateEntity();
        entity.setPluginId(state.getPluginId());
        entity.setEnabled(state.isEnabled());
        entity.setUpdatedAt(state.getUpdatedAt());
        return entity;
    }

    private SystemPluginState toDomain(SystemPluginStateEntity entity) {
        return new SystemPluginState()
                .setPluginId(entity.getPluginId())
                .setEnabled(entity.isEnabled())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
