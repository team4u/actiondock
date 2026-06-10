package org.team4u.actiondock.plugin;

import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 插件配置管理器，负责插件配置的读取、写入、合并和变量解析。
 *
 * @author jay.wu
 */
class PluginConfigManager {
    static final String DEFAULT_CONFIG_NAME = "default";
    private static final Pattern CONFIG_NAME_PATTERN = Pattern.compile("[A-Za-z0-9._-]{1,64}");

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
        return loadRawEffectiveConfig(defaultConfig, pluginId, DEFAULT_CONFIG_NAME);
    }

    Map<String, Object> loadRawEffectiveConfig(Map<String, Object> defaultConfig, String pluginId, String configName) {
        return mergeConfig(defaultConfig, readConfig(pluginId, normalizeConfigName(configName)));
    }

    Map<String, Object> loadRuntimeConfig(Map<String, Object> defaultConfig, String pluginId) {
        return loadRuntimeConfig(defaultConfig, pluginId, DEFAULT_CONFIG_NAME);
    }

    Map<String, Object> loadRuntimeConfig(Map<String, Object> defaultConfig, String pluginId, String configName) {
        return resolveRuntimeConfig(defaultConfig, readConfig(pluginId, normalizeConfigName(configName)));
    }

    Map<String, Object> resolveRuntimeConfig(Map<String, Object> defaultConfig, Map<String, Object> overrides) {
        return configValueApplicationService.resolveMap(mergeConfig(defaultConfig, overrides));
    }

    void writeConfig(String pluginId, Map<String, Object> config) {
        writeConfig(pluginId, DEFAULT_CONFIG_NAME, config);
    }

    void writeConfig(String pluginId, String configName, Map<String, Object> config) {
        String normalizedConfigName = normalizeConfigName(configName);
        try {
            Files.createDirectories(configPath(pluginId, normalizedConfigName).getParent());
            Files.writeString(configPath(pluginId, normalizedConfigName), jsonCodec.write(config));
        } catch (IOException e) {
            throw new PluginRuntimeException("保存插件配置失败: " + pluginId + "/" + normalizedConfigName, e);
        }
    }

    void deleteConfig(String pluginId) {
        try {
            Files.deleteIfExists(configPath(pluginId));
            Path namedRoot = namedConfigRoot(pluginId);
            if (Files.isDirectory(namedRoot)) {
                try (var stream = Files.walk(namedRoot)) {
                    stream.sorted(Comparator.reverseOrder()).forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (IOException e) {
                            throw new PluginRuntimeException("删除插件配置失败: " + pluginId, e);
                        }
                    });
                }
            }
        } catch (IOException e) {
            throw new PluginRuntimeException("删除插件配置失败: " + pluginId, e);
        }
    }

    void deleteNamedConfig(String pluginId, String configName) {
        String normalizedConfigName = normalizeNamedConfigName(configName);
        try {
            Files.deleteIfExists(configPath(pluginId, normalizedConfigName));
        } catch (IOException e) {
            throw new PluginRuntimeException("删除插件配置失败: " + pluginId + "/" + normalizedConfigName, e);
        }
    }

    boolean exists(String pluginId, String configName) {
        String normalizedConfigName = normalizeConfigName(configName);
        return DEFAULT_CONFIG_NAME.equals(normalizedConfigName) || Files.exists(configPath(pluginId, normalizedConfigName));
    }

    List<String> listConfigNames(String pluginId) {
        Path root = namedConfigRoot(pluginId);
        if (!Files.isDirectory(root)) {
            return List.of(DEFAULT_CONFIG_NAME);
        }
        try (var stream = Files.list(root)) {
            List<String> names = stream
                    .filter(path -> path.getFileName().toString().endsWith(".json"))
                    .map(path -> path.getFileName().toString())
                    .map(name -> name.substring(0, name.length() - ".json".length()))
                    .filter(name -> !DEFAULT_CONFIG_NAME.equals(name))
                    .sorted()
                    .toList();
            java.util.ArrayList<String> result = new java.util.ArrayList<>();
            result.add(DEFAULT_CONFIG_NAME);
            result.addAll(names);
            return result;
        } catch (IOException e) {
            throw new PluginRuntimeException("读取插件配置列表失败: " + pluginId, e);
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

    private Map<String, Object> readConfig(String pluginId, String configName) {
        try {
            Path path = configPath(pluginId, configName);
            if (!Files.exists(path)) {
                return new LinkedHashMap<>();
            }
            return normalizeConfig(jsonCodec.readMap(Files.readString(path)));
        } catch (IOException e) {
            throw new PluginRuntimeException("读取插件配置失败: " + pluginId + "/" + configName, e);
        }
    }

    private Path configPath(String pluginId) {
        return configRoot.resolve(pluginId + ".json");
    }

    private Path configPath(String pluginId, String configName) {
        String normalizedConfigName = normalizeConfigName(configName);
        return DEFAULT_CONFIG_NAME.equals(normalizedConfigName)
                ? configPath(pluginId)
                : namedConfigRoot(pluginId).resolve(normalizedConfigName + ".json");
    }

    private Path namedConfigRoot(String pluginId) {
        return configRoot.resolve(pluginId);
    }

    static String normalizeConfigName(String configName) {
        if (configName == null || configName.isBlank() || DEFAULT_CONFIG_NAME.equals(configName)) {
            return DEFAULT_CONFIG_NAME;
        }
        return normalizeNamedConfigName(configName);
    }

    static String normalizeNamedConfigName(String configName) {
        if (configName == null || configName.isBlank()) {
            throw new IllegalArgumentException("插件配置名不能为空");
        }
        String normalized = configName.trim();
        if (DEFAULT_CONFIG_NAME.equals(normalized)) {
            throw new IllegalArgumentException("default 是保留配置名");
        }
        if (!CONFIG_NAME_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException("插件配置名只能包含字母、数字、点、下划线和短横线，长度 1-64");
        }
        return normalized;
    }
}
