package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.SystemPluginState;

import java.util.List;
import java.util.Optional;

/**
 * Stores user-controlled enablement state for built-in system plugins.
 */
public interface SystemPluginStateRepository {
    SystemPluginState save(SystemPluginState state);

    Optional<SystemPluginState> findByPluginId(String pluginId);

    List<SystemPluginState> findAll();
}
