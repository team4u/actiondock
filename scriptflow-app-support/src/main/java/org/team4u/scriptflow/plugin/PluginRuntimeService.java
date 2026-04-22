package org.team4u.scriptflow.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginState;
import org.pf4j.PluginWrapper;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.plugin.api.PluginActionManifest;
import org.team4u.scriptflow.plugin.api.PluginManifest;
import org.team4u.scriptflow.plugin.api.PluginRuntimeException;
import org.team4u.scriptflow.plugin.api.ScriptFlowPlugin;
import org.team4u.scriptflow.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public class PluginRuntimeService {
    private static final PluginRuntimeService DISABLED = new PluginRuntimeService();

    private final JsonCodec jsonCodec;
    private final Path pluginsRoot;
    private final Path configRoot;
    private final DefaultPluginManager pluginManager;
    private final Map<String, PluginManifest> manifestCache;
    private final Map<String, ScriptFlowPlugin> extensionCache;
    private final boolean enabled;

    private PluginRuntimeService() {
        this.jsonCodec = null;
        this.pluginsRoot = null;
        this.configRoot = null;
        this.pluginManager = null;
        this.manifestCache = Map.of();
        this.extensionCache = Map.of();
        this.enabled = false;
    }

    public PluginRuntimeService(JsonCodec jsonCodec, AppProperties.Plugins properties) {
        this.jsonCodec = jsonCodec;
        this.pluginsRoot = Path.of(properties == null || properties.getDir() == null || properties.getDir().isBlank()
                ? "./plugins"
                : properties.getDir()).toAbsolutePath().normalize();
        this.configRoot = this.pluginsRoot.resolve(".scriptflow-config");
        this.pluginManager = new DefaultPluginManager(this.pluginsRoot);
        this.manifestCache = new HashMap<>();
        this.extensionCache = new HashMap<>();
        this.enabled = true;
        initialize();
    }

    public static PluginRuntimeService disabled() {
        return DISABLED;
    }

    public synchronized List<PluginView> list() {
        if (!enabled) {
            return List.of();
        }
        return pluginManager.getPlugins().stream()
                .sorted(Comparator.comparing(PluginWrapper::getPluginId))
                .map(this::toPluginView)
                .toList();
    }

    public synchronized PluginConfigView getConfig(String pluginId) {
        ScriptFlowPlugin plugin = requireExtension(pluginId);
        PluginManifest manifest = descriptorFor(pluginId, plugin);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(manifest.getConfigSchema())
                .setDefaultConfig(manifest.getDefaultConfig())
                .setConfig(loadEffectiveConfig(manifest));
    }

    public synchronized PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        ScriptFlowPlugin plugin = requireExtension(pluginId);
        PluginManifest manifest = descriptorFor(pluginId, plugin);
        Map<String, Object> normalized = normalizeConfig(config);
        plugin.validateConfig(normalized);
        writeConfig(pluginId, normalized);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(manifest.getConfigSchema())
                .setDefaultConfig(manifest.getDefaultConfig())
                .setConfig(normalized);
    }

    public synchronized PluginView install(String originalFilename, byte[] content) {
        ensureEnabled();
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("插件文件不能为空");
        }
        String fileName = sanitizeFilename(originalFilename);
        Path destination = uniquePluginPath(fileName);
        try {
            Files.createDirectories(pluginsRoot);
            Files.write(destination, content);
            String pluginId = pluginManager.loadPlugin(destination);
            if (pluginId == null || pluginId.isBlank()) {
                throw new IllegalStateException("插件加载失败，未返回 pluginId");
            }
            pluginManager.enablePlugin(pluginId);
            PluginState state = pluginManager.startPlugin(pluginId);
            if (!state.isStarted()) {
                throw new IllegalStateException("插件启动失败: " + pluginId);
            }
            cachePluginMetadata(pluginId);
            return toPluginView(requireWrapper(pluginId));
        } catch (Exception exception) {
            try {
                Files.deleteIfExists(destination);
            } catch (IOException ignored) {
            }
            throw new PluginRuntimeException("安装插件失败: " + exception.getMessage(), exception);
        }
    }

    public synchronized PluginView start(String pluginId) {
        ensureEnabled();
        requireWrapper(pluginId);
        pluginManager.enablePlugin(pluginId);
        PluginState state = pluginManager.startPlugin(pluginId);
        if (!state.isStarted()) {
            throw new PluginRuntimeException("启动插件失败: " + pluginId);
        }
        cachePluginMetadata(pluginId);
        return toPluginView(requireWrapper(pluginId));
    }

    public synchronized PluginView stop(String pluginId) {
        ensureEnabled();
        requireWrapper(pluginId);
        pluginManager.disablePlugin(pluginId);
        pluginManager.stopPlugin(pluginId);
        return toPluginView(requireWrapper(pluginId));
    }

    public synchronized void uninstall(String pluginId) {
        ensureEnabled();
        requireWrapper(pluginId);
        pluginManager.disablePlugin(pluginId);
        boolean deleted = pluginManager.deletePlugin(pluginId);
        if (!deleted) {
            throw new PluginRuntimeException("卸载插件失败: " + pluginId);
        }
        manifestCache.remove(pluginId);
        extensionCache.remove(pluginId);
        deleteConfig(pluginId);
    }

    public synchronized void assertActionAvailable(String pluginId, String action) {
        ScriptFlowPlugin plugin = requireExtension(pluginId);
        if (!isStarted(pluginId)) {
            throw new IllegalArgumentException("插件未启动: " + pluginId);
        }
        boolean exists = descriptorFor(pluginId, plugin).getActions().stream()
                .map(PluginActionManifest::getAction)
                .anyMatch(action::equals);
        if (!exists) {
            throw new IllegalArgumentException("插件动作不存在: " + pluginId + "/" + action);
        }
    }

    public synchronized Object invoke(String pluginId,
                                      String action,
                                      ScriptDefinition definition,
                                      ScriptExecutionContext executionContext,
                                      Map<String, Object> input,
                                      Map<String, Object> args) {
        assertActionAvailable(pluginId, action);
        ScriptFlowPlugin plugin = requireExtension(pluginId);
        try {
            return plugin.invoke(
                    action,
                    new ScriptPluginContext()
                            .setScriptId(definition == null ? null : definition.getId())
                            .setScriptName(definition == null ? null : definition.getName())
                            .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                            .setSubmitMode(resolveSubmitMode(executionContext))
                            .setScriptInput(input)
                            .setPluginConfig(loadEffectiveConfig(descriptorFor(pluginId, plugin))),
                    args == null ? Map.of() : new LinkedHashMap<>(args)
            );
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("插件调用失败 " + pluginId + "/" + action + ": " + exception.getMessage(), exception);
        }
    }

    private String resolveSubmitMode(ScriptExecutionContext executionContext) {
        SubmitMode submitMode = executionContext == null ? null : executionContext.getSubmitMode();
        return submitMode == null ? null : submitMode.name();
    }

    private void initialize() {
        try {
            Files.createDirectories(pluginsRoot);
            Files.createDirectories(configRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot initialize plugin directories", e);
        }
        pluginManager.loadPlugins();
        pluginManager.startPlugins();
        pluginManager.getStartedPlugins().forEach(wrapper -> cachePluginMetadata(wrapper.getPluginId()));
    }

    private boolean isStarted(String pluginId) {
        return requireWrapper(pluginId).getPluginState().isStarted();
    }

    private PluginWrapper requireWrapper(String pluginId) {
        ensureEnabled();
        PluginWrapper wrapper = pluginManager.getPlugin(pluginId);
        if (wrapper == null) {
            throw new IllegalArgumentException("插件不存在: " + pluginId);
        }
        return wrapper;
    }

    private ScriptFlowPlugin requireExtension(String pluginId) {
        requireWrapper(pluginId);
        ScriptFlowPlugin extension = pluginManager.getExtensions(ScriptFlowPlugin.class, pluginId).stream()
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(extensionCache.get(pluginId));
        if (extension == null) {
            throw new IllegalArgumentException("插件未暴露 ScriptFlow 扩展: " + pluginId);
        }
        extensionCache.put(pluginId, extension);
        return extension;
    }

    private PluginManifest descriptorFor(String pluginId, ScriptFlowPlugin plugin) {
        PluginManifest descriptor = plugin.descriptor();
        if (descriptor == null) {
            throw new IllegalArgumentException("插件描述不能为空: " + pluginId);
        }
        if (descriptor.getPluginId() == null || descriptor.getPluginId().isBlank()) {
            descriptor.setPluginId(pluginId);
        }
        if (!pluginId.equals(descriptor.getPluginId())) {
            throw new IllegalArgumentException("插件描述 pluginId 不匹配: " + pluginId);
        }
        return descriptor;
    }

    private PluginView toPluginView(PluginWrapper wrapper) {
        PluginManifest manifest = resolveManifest(wrapper);
        return new PluginView()
                .setPluginId(wrapper.getPluginId())
                .setName(manifest.getName() == null || manifest.getName().isBlank() ? wrapper.getPluginId() : manifest.getName())
                .setDescription(manifest.getDescription() == null ? wrapper.getDescriptor().getPluginDescription() : manifest.getDescription())
                .setVersion(manifest.getVersion() == null || manifest.getVersion().isBlank()
                        ? wrapper.getDescriptor().getVersion()
                        : manifest.getVersion())
                .setState(wrapper.getPluginState().name())
                .setStarted(wrapper.getPluginState().isStarted())
                .setConfigurable(!manifest.getConfigSchema().isEmpty() || !manifest.getDefaultConfig().isEmpty())
                .setActions(manifest.getActions().stream()
                        .map(this::toActionView)
                        .toList());
    }

    private void cachePluginMetadata(String pluginId) {
        ScriptFlowPlugin extension = requireExtension(pluginId);
        extensionCache.put(pluginId, extension);
        manifestCache.put(pluginId, descriptorFor(pluginId, extension));
    }

    private PluginManifest resolveManifest(PluginWrapper wrapper) {
        try {
            cachePluginMetadata(wrapper.getPluginId());
            return manifestCache.get(wrapper.getPluginId());
        } catch (IllegalArgumentException ignored) {
            PluginManifest cached = manifestCache.get(wrapper.getPluginId());
            if (cached != null) {
                return cached;
            }
            return new PluginManifest()
                    .setPluginId(wrapper.getPluginId())
                    .setName(wrapper.getPluginId())
                    .setDescription(wrapper.getDescriptor().getPluginDescription())
                    .setVersion(wrapper.getDescriptor().getVersion());
        }
    }

    private PluginActionView toActionView(PluginActionManifest actionManifest) {
        return new PluginActionView()
                .setAction(actionManifest.getAction())
                .setTitle(actionManifest.getTitle())
                .setDescription(actionManifest.getDescription())
                .setInputSchema(actionManifest.getInputSchema())
                .setExampleArgs(actionManifest.getExampleArgs());
    }

    private Map<String, Object> loadEffectiveConfig(PluginManifest manifest) {
        Map<String, Object> config = new LinkedHashMap<>(manifest.getDefaultConfig());
        config.putAll(readConfig(manifest.getPluginId()));
        return config;
    }

    private Map<String, Object> readConfig(String pluginId) {
        try {
            Path configPath = configPath(pluginId);
            if (!Files.exists(configPath)) {
                return new LinkedHashMap<>();
            }
            return normalizeConfig(jsonCodec.readMap(Files.readString(configPath)));
        } catch (IOException e) {
            throw new PluginRuntimeException("读取插件配置失败: " + pluginId, e);
        }
    }

    private void writeConfig(String pluginId, Map<String, Object> config) {
        try {
            Files.createDirectories(configRoot);
            Files.writeString(configPath(pluginId), jsonCodec.write(config));
        } catch (IOException e) {
            throw new PluginRuntimeException("保存插件配置失败: " + pluginId, e);
        }
    }

    private void deleteConfig(String pluginId) {
        try {
            Files.deleteIfExists(configPath(pluginId));
        } catch (IOException e) {
            throw new PluginRuntimeException("删除插件配置失败: " + pluginId, e);
        }
    }

    private Path configPath(String pluginId) {
        return configRoot.resolve(pluginId + ".json");
    }

    private Map<String, Object> normalizeConfig(Map<String, Object> config) {
        return config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
    }

    private Path uniquePluginPath(String fileName) {
        Path target = pluginsRoot.resolve(fileName);
        if (!Files.exists(target)) {
            return target;
        }
        int dot = fileName.lastIndexOf('.');
        String base = dot >= 0 ? fileName.substring(0, dot) : fileName;
        String extension = dot >= 0 ? fileName.substring(dot) : "";
        int index = 1;
        while (Files.exists(target)) {
            target = pluginsRoot.resolve(base + "-" + index + extension);
            index++;
        }
        return target;
    }

    private String sanitizeFilename(String originalFilename) {
        String value = originalFilename == null || originalFilename.isBlank() ? "plugin.jar" : originalFilename;
        String fileName = Path.of(value).getFileName().toString();
        if (!fileName.endsWith(".jar")) {
            throw new IllegalArgumentException("仅支持上传 .jar 插件包");
        }
        return fileName;
    }

    private void ensureEnabled() {
        if (!enabled) {
            throw new IllegalStateException("插件运行时未启用");
        }
    }
}
