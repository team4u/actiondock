package org.team4u.actiondock.plugin;

import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件配置管理器，负责插件配置的读取、写入、合并和变量解析。
 *
 * @author jay.wu
 */
class PluginConfigManager {

    private final JsonCodec jsonCodec;
    private final Path configRoot;
    private final ConfigValueApplicationService configValueApplicationService;

    PluginConfigManager(JsonCodec jsonCodec, Path configRoot, ConfigValueApplicationService configValueApplicationService) {
        this.jsonCodec = jsonCodec;
        this.configRoot = configRoot;
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
    }

    Map<String, Object> loadRawEffectiveConfig(Map<String, Object> defaultConfig, String pluginId) {
        return mergeConfig(defaultConfig, readConfig(pluginId));
    }

    Map<String, Object> loadRuntimeConfig(Map<String, Object> defaultConfig, String pluginId) {
        return resolveRuntimeConfig(defaultConfig, readConfig(pluginId));
    }

    Map<String, Object> resolveRuntimeConfig(Map<String, Object> defaultConfig, Map<String, Object> overrides) {
        return configValueApplicationService.resolveMap(mergeConfig(defaultConfig, overrides));
    }

    void writeConfig(String pluginId, Map<String, Object> config) {
        try {
            Files.createDirectories(configRoot);
            Files.writeString(configPath(pluginId), jsonCodec.write(config));
        } catch (IOException e) {
            throw new PluginRuntimeException("保存插件配置失败: " + pluginId, e);
        }
    }

    void deleteConfig(String pluginId) {
        try {
            Files.deleteIfExists(configPath(pluginId));
        } catch (IOException e) {
            throw new PluginRuntimeException("删除插件配置失败: " + pluginId, e);
        }
    }

    private static Map<String, Object> mergeConfig(Map<String, Object> defaultConfig, Map<String, Object> overrides) {
        Map<String, Object> merged = normalizeConfig(defaultConfig);
        merged.putAll(normalizeConfig(overrides));
        return merged;
    }

    static Map<String, Object> normalizeConfig(Map<String, Object> config) {
        return config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
    }

    private Map<String, Object> readConfig(String pluginId) {
        try {
            Path path = configPath(pluginId);
            if (!Files.exists(path)) {
                return new LinkedHashMap<>();
            }
            return normalizeConfig(jsonCodec.readMap(Files.readString(path)));
        } catch (IOException e) {
            throw new PluginRuntimeException("读取插件配置失败: " + pluginId, e);
        }
    }

    private Path configPath(String pluginId) {
        return configRoot.resolve(pluginId + ".json");
    }
}
