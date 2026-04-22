package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.PluginRegistration;

import java.util.List;
import java.util.Optional;

public interface PluginRegistryRepository {
    PluginRegistration save(PluginRegistration registration);

    Optional<PluginRegistration> findByPluginId(String pluginId);

    List<PluginRegistration> findAll();

    List<PluginRegistration> findEnabled();

    void deleteByPluginId(String pluginId);
}
