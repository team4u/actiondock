package org.team4u.actiondock.plugin;

import org.team4u.actiondock.common.NormalizeUtils;

import org.pf4j.PluginWrapper;
import org.pf4j.DefaultPluginManager;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginActionManifest;

import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 插件视图映射器，将领域模型转换为 API 响应视图。
 *
 * @author jay.wu
 */
class PluginViewMapper {

    private static final Logger LOGGER = LoggerFactory.getLogger(PluginViewMapper.class);
    private static final String PLUGIN_STATE_ENABLED = "ENABLED";
    private static final String PLUGIN_STATE_DISABLED = "DISABLED";

    static PluginView toPluginView(PluginRegistration registration, DefaultPluginManager pluginManager) {
        PluginWrapper wrapper = pluginManager.getPlugin(registration.getPluginId());
        String state = wrapper == null
                ? (registration.isEnabled() ? PLUGIN_STATE_ENABLED : PLUGIN_STATE_DISABLED)
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
                .setSourceType(PluginReferenceSourceType.INSTALLED)
                .setStarted(wrapper != null && wrapper.getPluginState().isStarted())
                .setConfigurable(!registration.getConfigSchema().isEmpty() || !registration.getDefaultConfig().isEmpty())
                .setFileName(registration.getFileName())
                .setActions(registration.getActions().stream()
                        .map(PluginViewMapper::toActionView)
                        .toList());
    }

    static PluginSummaryView toPluginSummaryView(PluginRegistration registration, DefaultPluginManager pluginManager) {
        PluginWrapper wrapper = pluginManager.getPlugin(registration.getPluginId());
        String state = wrapper == null
                ? (registration.isEnabled() ? PLUGIN_STATE_ENABLED : PLUGIN_STATE_DISABLED)
                : wrapper.getPluginState().name();
        return new PluginSummaryView()
                .setPluginId(registration.getPluginId())
                .setName(registration.getName())
                .setDescription(registration.getDescription())
                .setVersion(registration.getVersion())
                .setRepositoryId(registration.getRepositoryId())
                .setRepositoryPluginId(registration.getRepositoryPluginId())
                .setRepositoryVersion(registration.getRepositoryVersion())
                .setState(state)
                .setSourceType(PluginReferenceSourceType.INSTALLED)
                .setStarted(wrapper != null && wrapper.getPluginState().isStarted())
                .setConfigurable(!registration.getConfigSchema().isEmpty() || !registration.getDefaultConfig().isEmpty())
                .setFileName(registration.getFileName())
                .setActionCount(registration.getActions().size());
    }

    static PluginReferenceView toInstalledPluginReferenceView(PluginRegistration registration) {
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

    static PluginReferenceView toSystemPluginReferenceView(String pluginId, ActionDockPlugin plugin) {
        PluginManifest manifest;
        try {
            manifest = PluginManifestLoader.load(plugin.getClass(), pluginId);
        } catch (IllegalArgumentException exception) {
            LOGGER.warn("System plugin reference manifest missing: {}", pluginId);
            return null;
        }
        return new PluginReferenceView()
                .setPluginId(pluginId)
                .setName(NormalizeUtils.isBlank(manifest.getName()) ? pluginId : manifest.getName())
                .setDescription(manifest.getDescription())
                .setVersion(manifest.getVersion())
                .setSourceType(PluginReferenceSourceType.SYSTEM)
                .setStarted(true)
                .setActions(manifest.getActions().stream()
                        .map(PluginViewMapper::toActionView)
                        .toList());
    }

    static PluginView toSystemPluginView(String pluginId, ActionDockPlugin plugin, boolean enabled) {
        PluginManifest manifest;
        try {
            manifest = PluginManifestLoader.load(plugin.getClass(), pluginId);
        } catch (IllegalArgumentException exception) {
            LOGGER.warn("System plugin manifest missing: {}", pluginId);
            return null;
        }
        return new PluginView()
                .setPluginId(pluginId)
                .setName(NormalizeUtils.isBlank(manifest.getName()) ? pluginId : manifest.getName())
                .setDescription(manifest.getDescription())
                .setVersion(manifest.getVersion())
                .setState(enabled ? "STARTED" : PLUGIN_STATE_DISABLED)
                .setSourceType(PluginReferenceSourceType.SYSTEM)
                .setStarted(enabled)
                .setConfigurable(isConfigurable(manifest))
                .setActions(manifest.getActions().stream()
                        .map(PluginViewMapper::toActionView)
                        .toList());
    }

    static PluginSummaryView toSystemPluginSummaryView(String pluginId, ActionDockPlugin plugin, boolean enabled) {
        PluginManifest manifest;
        try {
            manifest = PluginManifestLoader.load(plugin.getClass(), pluginId);
        } catch (IllegalArgumentException exception) {
            LOGGER.warn("System plugin manifest missing: {}", pluginId);
            return null;
        }
        return new PluginSummaryView()
                .setPluginId(pluginId)
                .setName(NormalizeUtils.isBlank(manifest.getName()) ? pluginId : manifest.getName())
                .setDescription(manifest.getDescription())
                .setVersion(manifest.getVersion())
                .setState(enabled ? "STARTED" : PLUGIN_STATE_DISABLED)
                .setSourceType(PluginReferenceSourceType.SYSTEM)
                .setStarted(enabled)
                .setConfigurable(isConfigurable(manifest))
                .setActionCount(manifest.getActions().size());
    }

    static PluginRegistration toSystemRegistration(String pluginId, ActionDockPlugin plugin, boolean enabled) {
        PluginManifest manifest = PluginManifestLoader.load(plugin.getClass(), pluginId);
        return toRegistration(manifest, null, enabled, null);
    }

    private static boolean isConfigurable(PluginManifest manifest) {
        return manifest != null && (!manifest.getConfigSchema().isEmpty() || !manifest.getDefaultConfig().isEmpty());
    }

    private static PluginActionView toActionView(PluginActionMetadata actionMetadata) {
        return new PluginActionView()
                .setAction(actionMetadata.getAction())
                .setTitle(actionMetadata.getTitle())
                .setDescription(actionMetadata.getDescription())
                .setInputSchema(actionMetadata.getInputSchema())
                .setOutputSchema(actionMetadata.getOutputSchema())
                .setExampleArgs(actionMetadata.getExampleArgs())
                .setAiHints(actionMetadata.getAiHints());
    }

    private static PluginActionView toActionView(PluginActionManifest action) {
        return toActionView(toActionMetadata(action));
    }

    private static PluginActionMetadata toActionMetadata(PluginActionManifest action) {
        return new PluginActionMetadata()
                .setAction(action.getAction())
                .setTitle(action.getTitle())
                .setDescription(action.getDescription())
                .setInputSchema(action.getInputSchema())
                .setOutputSchema(action.getOutputSchema())
                .setExampleArgs(action.getExampleArgs())
                .setAiHints(action.getAiHints());
    }

    static PluginRegistration toRegistration(PluginManifest manifest,
                                             String fileName,
                                             boolean enabled,
                                             PluginRegistration existing) {
        LocalDateTime now = LocalDateTime.now();
        return new PluginRegistration()
                .setPluginId(manifest.getPluginId())
                .setName(NormalizeUtils.isBlank(manifest.getName()) ? manifest.getPluginId() : manifest.getName())
                .setDescription(manifest.getDescription())
                .setVersion(manifest.getVersion())
                .setFileName(fileName)
                .setConfigSchema(manifest.getConfigSchema())
                .setDefaultConfig(manifest.getDefaultConfig())
                .setActions(manifest.getActions().stream()
                        .map(PluginViewMapper::toActionMetadata)
                        .toList())
                .setEnabled(enabled)
                .setInstalledAt(existing == null ? now : existing.getInstalledAt())
                .setUpdatedAt(now);
    }
}
