package org.team4u.actiondock.plugin;

import org.pf4j.PluginWrapper;
import org.pf4j.DefaultPluginManager;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * 插件视图映射器，将领域模型转换为 API 响应视图。
 *
 * @author jay.wu
 */
class PluginViewMapper {

    private static final Logger LOGGER = Logger.getLogger(PluginViewMapper.class.getName());

    PluginView toPluginView(PluginRegistration registration, DefaultPluginManager pluginManager) {
        PluginWrapper wrapper = pluginManager.getPlugin(registration.getPluginId());
        String state = wrapper == null
                ? (registration.isEnabled() ? "ENABLED" : "DISABLED")
                : wrapper.getPluginState().name();
        return new PluginView()
                .setPluginId(registration.getPluginId())
                .setName(registration.getName())
                .setDescription(registration.getDescription())
                .setVersion(registration.getVersion())
                .setRepositoryId(registration.getRepositoryId())
                .setRepositoryPluginId(registration.getRepositoryPluginId())
                .setRepositoryVersion(registration.getRepositoryVersion())
                .setState(state)
                .setStarted(wrapper != null && wrapper.getPluginState().isStarted())
                .setConfigurable(!registration.getConfigSchema().isEmpty() || !registration.getDefaultConfig().isEmpty())
                .setFileName(registration.getFileName())
                .setActions(registration.getActions().stream()
                        .map(PluginViewMapper::toActionView)
                        .toList());
    }

    PluginReferenceView toInstalledPluginReferenceView(PluginRegistration registration) {
        return new PluginReferenceView()
                .setPluginId(registration.getPluginId())
                .setName(registration.getName())
                .setDescription(registration.getDescription())
                .setVersion(registration.getVersion())
                .setSourceType(PluginReferenceSourceType.INSTALLED)
                .setStarted(true)
                .setActions(registration.getActions().stream()
                        .map(PluginViewMapper::toActionView)
                        .toList());
    }

    PluginReferenceView toSystemPluginReferenceView(String pluginId, ActionDockPlugin plugin) {
        PluginManifest manifest;
        try {
            manifest = PluginManifestLoader.load(plugin.getClass(), pluginId);
        } catch (IllegalArgumentException exception) {
            LOGGER.log(Level.WARNING, "System plugin reference manifest missing: {0}", pluginId);
            return null;
        }
        return new PluginReferenceView()
                .setPluginId(pluginId)
                .setName(manifest.getName() == null || manifest.getName().isBlank() ? pluginId : manifest.getName())
                .setDescription(manifest.getDescription())
                .setVersion(manifest.getVersion())
                .setSourceType(PluginReferenceSourceType.SYSTEM)
                .setStarted(true)
                .setActions(manifest.getActions().stream()
                        .map(action -> new PluginActionView()
                                .setAction(action.getAction())
                                .setTitle(action.getTitle())
                                .setDescription(action.getDescription())
                                .setInputSchema(action.getInputSchema())
                                .setOutputSchema(action.getOutputSchema())
                                .setExampleArgs(action.getExampleArgs()))
                        .toList());
    }

    static PluginActionView toActionView(PluginActionMetadata actionMetadata) {
        return new PluginActionView()
                .setAction(actionMetadata.getAction())
                .setTitle(actionMetadata.getTitle())
                .setDescription(actionMetadata.getDescription())
                .setInputSchema(actionMetadata.getInputSchema())
                .setOutputSchema(actionMetadata.getOutputSchema())
                .setExampleArgs(actionMetadata.getExampleArgs());
    }

    static PluginRegistration toRegistration(PluginManifest manifest,
                                             String fileName,
                                             boolean enabled,
                                             PluginRegistration existing) {
        LocalDateTime now = LocalDateTime.now();
        return new PluginRegistration()
                .setPluginId(manifest.getPluginId())
                .setName(manifest.getName() == null || manifest.getName().isBlank() ? manifest.getPluginId() : manifest.getName())
                .setDescription(manifest.getDescription())
                .setVersion(manifest.getVersion())
                .setFileName(fileName)
                .setConfigSchema(manifest.getConfigSchema())
                .setDefaultConfig(manifest.getDefaultConfig())
                .setActions(manifest.getActions().stream()
                        .map(action -> new PluginActionMetadata()
                                .setAction(action.getAction())
                                .setTitle(action.getTitle())
                                .setDescription(action.getDescription())
                                .setInputSchema(action.getInputSchema())
                                .setOutputSchema(action.getOutputSchema())
                                .setExampleArgs(action.getExampleArgs()))
                        .toList())
                .setEnabled(enabled)
                .setInstalledAt(existing == null ? now : existing.getInstalledAt())
                .setUpdatedAt(now);
    }

    static PluginRegistration cloneRegistration(PluginRegistration registration) {
        return new PluginRegistration()
                .setPluginId(registration.getPluginId())
                .setName(registration.getName())
                .setDescription(registration.getDescription())
                .setVersion(registration.getVersion())
                .setFileName(registration.getFileName())
                .setRepositoryId(registration.getRepositoryId())
                .setRepositoryPluginId(registration.getRepositoryPluginId())
                .setRepositoryVersion(registration.getRepositoryVersion())
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setActions(registration.getActions())
                .setEnabled(registration.isEnabled())
                .setInstalledAt(registration.getInstalledAt())
                .setUpdatedAt(registration.getUpdatedAt());
    }
}
