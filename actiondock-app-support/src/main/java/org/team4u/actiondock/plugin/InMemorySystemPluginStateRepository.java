package org.team4u.actiondock.plugin;

import org.team4u.actiondock.domain.model.SystemPluginState;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

class InMemorySystemPluginStateRepository implements SystemPluginStateRepository {
    private final Map<String, SystemPluginState> values = new ConcurrentHashMap<>();

    @Override
    public SystemPluginState save(SystemPluginState state) {
        SystemPluginState copy = state.copy();
        values.put(copy.getPluginId(), copy);
        return copy.copy();
    }

    @Override
    public Optional<SystemPluginState> findByPluginId(String pluginId) {
        SystemPluginState state = values.get(pluginId);
        return state == null ? Optional.empty() : Optional.of(state.copy());
    }

    @Override
    public List<SystemPluginState> findAll() {
        return values.values().stream().map(SystemPluginState::copy).toList();
    }
}
