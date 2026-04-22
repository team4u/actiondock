package org.team4u.scriptflow.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginState;
import org.pf4j.PluginWrapper;
import org.team4u.scriptflow.application.ExecutionOutputProjector;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.PluginActionMetadata;
import org.team4u.scriptflow.domain.model.PluginRegistration;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.PluginRegistryRepository;
import org.team4u.scriptflow.plugin.api.PluginManifest;
import org.team4u.scriptflow.plugin.api.PluginManifestLoader;
import org.team4u.scriptflow.plugin.api.PluginRuntimeException;
import org.team4u.scriptflow.plugin.api.ScriptFlowPlugin;
import org.team4u.scriptflow.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public class PluginRuntimeService {
    private static final PluginRuntimeService DISABLED = new PluginRuntimeService();

    private final JsonCodec jsonCodec;
    private final PluginRegistryRepository pluginRegistryRepository;
    private final Path pluginsRoot;
    private final Path configRoot;
    private final DefaultPluginManager pluginManager;
    private final Map<String, PluginManifest> manifestCache;
    private final ExecutionOutputProjector executionOutputProjector;
    private final boolean enabled;

    private PluginRuntimeService() {
        this.jsonCodec = null;
        this.pluginRegistryRepository = null;
        this.pluginsRoot = null;
        this.configRoot = null;
        this.pluginManager = null;
        this.manifestCache = Map.of();
        this.executionOutputProjector = null;
        this.enabled = false;
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties) {
        this.jsonCodec = jsonCodec;
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.pluginsRoot = Path.of(properties == null || properties.getDir() == null || properties.getDir().isBlank()
                ? "./plugins"
                : properties.getDir()).toAbsolutePath().normalize();
        this.configRoot = this.pluginsRoot.resolve(".scriptflow-config");
        this.pluginManager = new DefaultPluginManager(this.pluginsRoot);
        this.manifestCache = new HashMap<>();
        this.executionOutputProjector = new ExecutionOutputProjector();
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
        return pluginRegistryRepository.findAll().stream()
                .sorted(Comparator.comparing(PluginRegistration::getPluginId))
                .map(this::toPluginView)
                .toList();
    }

    public synchronized PluginView get(String pluginId) {
        return toPluginView(requireRegistration(pluginId));
    }

    public synchronized PluginConfigView getConfig(String pluginId) {
        PluginRegistration registration = requireRegistration(pluginId);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(loadEffectiveConfig(registration));
    }

    public synchronized PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        PluginRegistration registration = requireRegistration(pluginId);
        Map<String, Object> normalized = normalizeConfig(config);
        ScriptFlowPlugin plugin = findLoadedExtension(pluginId);
        if (plugin != null) {
            plugin.validateConfig(normalized);
        }
        writeConfig(pluginId, normalized);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(normalized);
    }

    public synchronized PluginView install(String originalFilename, byte[] content) {
        ensureEnabled();
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("插件文件不能为空");
        }

        String fileName = sanitizeFilename(originalFilename);
        Path destination = uniquePluginPath(fileName);
        String pluginId = null;
        try {
            Files.createDirectories(pluginsRoot);
            Files.write(destination, content);
            pluginId = loadPlugin(destination);
            PluginManifest manifest = cacheManifest(pluginId);
            if (pluginRegistryRepository.findByPluginId(pluginId).isPresent()) {
                throw new IllegalArgumentException("插件已存在: " + pluginId);
            }

            PluginRegistration saved = pluginRegistryRepository.save(
                    toRegistration(manifest, destination.getFileName().toString(), true, null)
            );
            return toPluginView(saved);
        } catch (Exception exception) {
            if (pluginId != null) {
                unloadIfLoaded(pluginId);
            }
            try {
                Files.deleteIfExists(destination);
            } catch (IOException ignored) {
            }
            throw new PluginRuntimeException("安装插件失败: " + exception.getMessage(), exception);
        }
    }

    public synchronized PluginView upgrade(String pluginId, String originalFilename, byte[] content) {
        ensureEnabled();
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("插件文件不能为空");
        }

        PluginRegistration current = requireRegistration(pluginId);
        PluginRegistration backup = cloneRegistration(current);
        Path oldPluginPath = resolvePluginPath(current);
        boolean wasEnabled = current.isEnabled();
        String fileName = sanitizeFilename(originalFilename);
        Path destination = uniquePluginPath(fileName);
        String loadedPluginId = null;
        PluginRegistration saved = null;

        try {
            unloadIfLoaded(pluginId);

            Files.createDirectories(pluginsRoot);
            Files.write(destination, content);
            loadedPluginId = loadPlugin(destination);
            if (!pluginId.equals(loadedPluginId)) {
                throw new IllegalArgumentException("插件 ID 与升级目标不一致: " + loadedPluginId);
            }

            PluginManifest manifest = cacheManifest(pluginId);
            saved = pluginRegistryRepository.save(mergeRegistrationWithFileName(backup, manifest, destination.getFileName().toString()));

            if (!wasEnabled) {
                unloadIfLoaded(pluginId);
            }

            if (!oldPluginPath.equals(destination)) {
                Files.deleteIfExists(oldPluginPath);
            }
            return toPluginView(saved);
        } catch (Exception exception) {
            if (loadedPluginId != null) {
                unloadIfLoaded(loadedPluginId);
            }
            try {
                Files.deleteIfExists(destination);
            } catch (IOException ignored) {
            }
            if (saved != null) {
                pluginRegistryRepository.save(backup);
            }
            if (wasEnabled) {
                try {
                    loadRegisteredPlugin(backup);
                } catch (Exception ignored) {
                }
            }
            throw new PluginRuntimeException("升级插件失败: " + exception.getMessage(), exception);
        }
    }

    public synchronized PluginView start(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        PluginManifest manifest = loadRegisteredPlugin(registration);
        PluginRegistration saved = pluginRegistryRepository.save(
                mergeRegistration(registration, manifest, true)
        );
        return toPluginView(saved);
    }

    public synchronized PluginView stop(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        unloadIfLoaded(pluginId);
        PluginRegistration saved = pluginRegistryRepository.save(
                cloneRegistration(registration)
                        .setEnabled(false)
                        .setUpdatedAt(LocalDateTime.now())
        );
        return toPluginView(saved);
    }

    public synchronized void uninstall(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        unloadIfLoaded(pluginId);
        deletePluginFile(registration);
        pluginRegistryRepository.deleteByPluginId(pluginId);
        manifestCache.remove(pluginId);
        deleteConfig(pluginId);
    }

    public synchronized void assertActionAvailable(String pluginId, String action) {
        PluginRegistration registration = requireRegistration(pluginId);
        if (!registration.isEnabled() || !isLoadedAndStarted(pluginId)) {
            throw new IllegalArgumentException("插件未启动: " + pluginId);
        }
        boolean exists = registration.getActions().stream()
                .map(PluginActionMetadata::getAction)
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
        PluginRegistration registration = requireRegistration(pluginId);
        ScriptFlowPlugin plugin = requireLoadedExtension(pluginId);
        try {
            return plugin.invoke(
                    action,
                    new ScriptPluginContext()
                            .setScriptId(definition == null ? null : definition.getId())
                            .setScriptName(definition == null ? null : definition.getName())
                            .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                            .setSubmitMode(resolveSubmitMode(executionContext))
                            .setScriptInput(input)
                            .setPluginConfig(loadEffectiveConfig(registration)),
                    args == null ? Map.of() : new LinkedHashMap<>(args)
            );
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("插件调用失败 " + pluginId + "/" + action + ": " + exception.getMessage(), exception);
        }
    }

    public synchronized PluginInvokeView invokeForDebug(String pluginId,
                                                        String action,
                                                        Map<String, Object> args,
                                                        Map<String, Object> scriptInput,
                                                        boolean includeDebug) {
        PluginRegistration registration = requireRegistration(pluginId);
        PluginActionMetadata actionMetadata = requireActionMetadata(registration, action);
        Map<String, Object> normalizedArgs = normalizeConfig(args);
        Map<String, Object> normalizedScriptInput = normalizeConfig(scriptInput);
        Map<String, Object> pluginResult = normalizeResult(
                invoke(
                        pluginId,
                        action,
                        null,
                        new ScriptExecutionContext().setSubmitMode(SubmitMode.SYNC),
                        normalizedScriptInput,
                        normalizedArgs
                )
        );
        return new PluginInvokeView()
                .setPluginId(pluginId)
                .setAction(action)
                .setResult(executionOutputProjector.project(pluginResult, actionMetadata.getOutputSchema()))
                .setDebug(includeDebug
                        ? new PluginInvokeDebugView()
                        .setArgs(normalizedArgs)
                        .setScriptInput(normalizedScriptInput)
                        : null);
    }

    private void initialize() {
        try {
            Files.createDirectories(pluginsRoot);
            Files.createDirectories(configRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot initialize plugin directories", e);
        }

        pluginRegistryRepository.findEnabled().forEach(registration -> {
            try {
                PluginManifest manifest = loadRegisteredPlugin(registration);
                pluginRegistryRepository.save(mergeRegistration(registration, manifest, true));
            } catch (Exception ignored) {
            }
        });
    }

    private String resolveSubmitMode(ScriptExecutionContext executionContext) {
        SubmitMode submitMode = executionContext == null ? null : executionContext.getSubmitMode();
        return submitMode == null ? null : submitMode.name();
    }

    private PluginRegistration requireRegistration(String pluginId) {
        ensureEnabled();
        return pluginRegistryRepository.findByPluginId(pluginId)
                .orElseThrow(() -> new IllegalArgumentException("插件不存在: " + pluginId));
    }

    private PluginActionMetadata requireActionMetadata(PluginRegistration registration, String action) {
        return registration.getActions().stream()
                .filter(metadata -> action.equals(metadata.getAction()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("插件动作不存在: " + registration.getPluginId() + "/" + action));
    }

    private boolean isLoadedAndStarted(String pluginId) {
        PluginWrapper wrapper = pluginManager.getPlugin(pluginId);
        return wrapper != null && wrapper.getPluginState().isStarted();
    }

    private ScriptFlowPlugin requireLoadedExtension(String pluginId) {
        ScriptFlowPlugin extension = findLoadedExtension(pluginId);
        if (extension == null) {
            throw new IllegalArgumentException("插件未加载到 JVM: " + pluginId);
        }
        return extension;
    }

    private ScriptFlowPlugin findLoadedExtension(String pluginId) {
        return pluginManager.getExtensions(ScriptFlowPlugin.class, pluginId).stream()
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    private PluginManifest loadRegisteredPlugin(PluginRegistration registration) {
        Path pluginPath = resolvePluginPath(registration);
        if (!Files.exists(pluginPath)) {
            throw new IllegalArgumentException("插件文件不存在: " + pluginPath);
        }

        PluginWrapper existing = pluginManager.getPlugin(registration.getPluginId());
        if (existing == null) {
            String loadedPluginId = pluginManager.loadPlugin(pluginPath);
            if (!registration.getPluginId().equals(loadedPluginId)) {
                throw new IllegalArgumentException("插件 ID 与数据库记录不一致: " + loadedPluginId);
            }
        }

        PluginState state = pluginManager.startPlugin(registration.getPluginId());
        if (!state.isStarted()) {
            throw new IllegalStateException("插件启动失败: " + registration.getPluginId());
        }
        return cacheManifest(registration.getPluginId());
    }

    private String loadPlugin(Path pluginPath) {
        String pluginId = pluginManager.loadPlugin(pluginPath);
        if (pluginId == null || pluginId.isBlank()) {
            throw new IllegalStateException("插件加载失败，未返回 pluginId");
        }
        PluginState state = pluginManager.startPlugin(pluginId);
        if (!state.isStarted()) {
            throw new IllegalStateException("插件启动失败: " + pluginId);
        }
        return pluginId;
    }

    private PluginManifest cacheManifest(String pluginId) {
        ScriptFlowPlugin extension = requireLoadedExtension(pluginId);
        String declaredPluginId = extension.id();
        if (declaredPluginId == null || declaredPluginId.isBlank()) {
            throw new IllegalArgumentException("插件 ID 不能为空: " + pluginId);
        }
        if (!pluginId.equals(declaredPluginId)) {
            throw new IllegalArgumentException("插件扩展 ID 不匹配: " + pluginId);
        }
        PluginManifest manifest = PluginManifestLoader.load(extension.getClass(), pluginId);
        if (manifest == null) {
            throw new IllegalArgumentException("插件描述不能为空: " + pluginId);
        }
        if (manifest.getPluginId() == null || manifest.getPluginId().isBlank()) {
            manifest.setPluginId(pluginId);
        }
        if (!pluginId.equals(manifest.getPluginId())) {
            throw new IllegalArgumentException("插件描述 pluginId 不匹配: " + pluginId);
        }
        manifestCache.put(pluginId, manifest);
        return manifest;
    }

    private PluginRegistration toRegistration(PluginManifest manifest,
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

    private PluginRegistration mergeRegistration(PluginRegistration existing, PluginManifest manifest, boolean enabled) {
        return toRegistration(manifest, existing.getFileName(), enabled, existing);
    }

    private PluginRegistration mergeRegistrationWithFileName(PluginRegistration existing,
                                                             PluginManifest manifest,
                                                             String fileName) {
        return toRegistration(manifest, fileName, existing.isEnabled(), existing);
    }

    private PluginRegistration cloneRegistration(PluginRegistration registration) {
        return new PluginRegistration()
                .setPluginId(registration.getPluginId())
                .setName(registration.getName())
                .setDescription(registration.getDescription())
                .setVersion(registration.getVersion())
                .setFileName(registration.getFileName())
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setActions(registration.getActions())
                .setEnabled(registration.isEnabled())
                .setInstalledAt(registration.getInstalledAt())
                .setUpdatedAt(registration.getUpdatedAt());
    }

    private PluginView toPluginView(PluginRegistration registration) {
        PluginWrapper wrapper = pluginManager.getPlugin(registration.getPluginId());
        String state = wrapper == null
                ? (registration.isEnabled() ? "ENABLED" : "DISABLED")
                : wrapper.getPluginState().name();
        return new PluginView()
                .setPluginId(registration.getPluginId())
                .setName(registration.getName())
                .setDescription(registration.getDescription())
                .setVersion(registration.getVersion())
                .setState(state)
                .setStarted(wrapper != null && wrapper.getPluginState().isStarted())
                .setConfigurable(!registration.getConfigSchema().isEmpty() || !registration.getDefaultConfig().isEmpty())
                .setActions(registration.getActions().stream()
                        .map(this::toActionView)
                        .toList());
    }

    private PluginActionView toActionView(PluginActionMetadata actionMetadata) {
        return new PluginActionView()
                .setAction(actionMetadata.getAction())
                .setTitle(actionMetadata.getTitle())
                .setDescription(actionMetadata.getDescription())
                .setInputSchema(actionMetadata.getInputSchema())
                .setOutputSchema(actionMetadata.getOutputSchema())
                .setExampleArgs(actionMetadata.getExampleArgs());
    }

    private Map<String, Object> loadEffectiveConfig(PluginRegistration registration) {
        Map<String, Object> config = new LinkedHashMap<>(registration.getDefaultConfig());
        config.putAll(readConfig(registration.getPluginId()));
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

    private void unloadIfLoaded(String pluginId) {
        PluginWrapper wrapper = pluginManager.getPlugin(pluginId);
        if (wrapper == null) {
            return;
        }
        try {
            if (wrapper.getPluginState().isStarted()) {
                pluginManager.stopPlugin(pluginId);
            }
        } finally {
            pluginManager.unloadPlugin(pluginId);
        }
    }

    private void deletePluginFile(PluginRegistration registration) {
        try {
            Files.deleteIfExists(resolvePluginPath(registration));
        } catch (IOException e) {
            throw new PluginRuntimeException("删除插件文件失败: " + registration.getPluginId(), e);
        }
    }

    private Path resolvePluginPath(PluginRegistration registration) {
        return pluginsRoot.resolve(registration.getFileName()).normalize();
    }

    private Path configPath(String pluginId) {
        return configRoot.resolve(pluginId + ".json");
    }

    private Map<String, Object> normalizeConfig(Map<String, Object> config) {
        return config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
    }

    private Map<String, Object> normalizeResult(Object result) {
        if (result == null) {
            return new LinkedHashMap<>();
        }
        if (result instanceof Map<?, ?> source) {
            Map<String, Object> normalized = new LinkedHashMap<>();
            source.forEach((key, value) -> normalized.put(String.valueOf(key), value));
            return normalized;
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("result", result);
        return normalized;
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
