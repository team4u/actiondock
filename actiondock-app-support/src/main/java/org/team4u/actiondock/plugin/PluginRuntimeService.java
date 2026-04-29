package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginState;
import org.pf4j.PluginWrapper;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.application.ExecutionOutputProjector;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * 插件运行时服务，管理插件的完整生命周期。
 * <p>
 * 基于 PF4J 框架提供插件的安装、启停、卸载、配置管理和动作调用能力。
 * 配置管理委托给 {@link PluginConfigManager}，视图映射委托给 {@link PluginViewMapper}。
 *
 * @author jay.wu
 */
public class PluginRuntimeService {
    private static final Logger LOGGER = Logger.getLogger(PluginRuntimeService.class.getName());
    private static final PluginRuntimeService DISABLED = new PluginRuntimeService();

    private final PluginRegistryRepository pluginRegistryRepository;
    private final ScriptRepository scriptRepository;
    private final Path pluginsRoot;
    private final DefaultPluginManager pluginManager;
    private final Map<String, ActionDockPlugin> systemPlugins;
    private final Map<String, PluginManifest> manifestCache;
    private final ExecutionOutputProjector executionOutputProjector;
    private final ConfigValueApplicationService configValueApplicationService;
    private final PluginConfigManager configManager;
    private final PluginViewMapper viewMapper;
    private final boolean enabled;

    private PluginRuntimeService() {
        this.pluginRegistryRepository = null;
        this.scriptRepository = null;
        this.pluginsRoot = null;
        this.pluginManager = null;
        this.systemPlugins = Map.of();
        this.manifestCache = Map.of();
        this.executionOutputProjector = null;
        this.configValueApplicationService = ConfigValueApplicationService.disabled();
        this.configManager = null;
        this.viewMapper = null;
        this.enabled = false;
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties) {
        this(jsonCodec, pluginRegistryRepository, null, properties, ConfigValueApplicationService.disabled(), List.of());
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties,
                                ConfigValueApplicationService configValueApplicationService) {
        this(jsonCodec, pluginRegistryRepository, null, properties, configValueApplicationService, List.of());
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties,
                                ConfigValueApplicationService configValueApplicationService,
                                List<ActionDockPlugin> systemPlugins) {
        this(jsonCodec, pluginRegistryRepository, null, properties, configValueApplicationService, systemPlugins);
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                ScriptRepository scriptRepository,
                                AppProperties.Plugins properties,
                                ConfigValueApplicationService configValueApplicationService,
                                List<ActionDockPlugin> systemPlugins) {
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.scriptRepository = scriptRepository;
        this.pluginsRoot = Path.of(properties == null || properties.getDir() == null || properties.getDir().isBlank()
                ? AppProperties.defaultPluginsDir()
                : properties.getDir()).toAbsolutePath().normalize();
        Path configRoot = this.pluginsRoot.resolve(".actiondock-config");
        this.pluginManager = new DefaultPluginManager(this.pluginsRoot);
        this.systemPlugins = systemPlugins == null ? Map.of() : systemPlugins.stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(ActionDockPlugin::id, plugin -> plugin));
        this.manifestCache = new HashMap<>();
        this.executionOutputProjector = new ExecutionOutputProjector();
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
        this.configManager = new PluginConfigManager(jsonCodec, configRoot, configValueApplicationService);
        this.viewMapper = new PluginViewMapper();
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
                .map(reg -> viewMapper.toPluginView(reg, pluginManager))
                .toList();
    }

    public synchronized List<PluginReferenceView> listPluginReferences() {
        if (!enabled) {
            return List.of();
        }
        List<PluginReferenceView> references = new ArrayList<>();
        pluginRegistryRepository.findAll().stream()
                .filter(registration -> isLoadedAndStarted(registration.getPluginId()))
                .sorted(Comparator.comparing(PluginRegistration::getPluginId))
                .map(viewMapper::toInstalledPluginReferenceView)
                .forEach(references::add);
        systemPlugins.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> viewMapper.toSystemPluginReferenceView(entry.getKey(), entry.getValue()))
                .filter(Objects::nonNull)
                .forEach(references::add);
        return references.stream()
                .sorted(Comparator.comparing(PluginReferenceView::getPluginId))
                .toList();
    }

    public synchronized PluginView get(String pluginId) {
        return viewMapper.toPluginView(requireRegistration(pluginId), pluginManager);
    }

    public synchronized PluginConfigView getConfig(String pluginId) {
        PluginRegistration registration = requireRegistration(pluginId);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(configManager.loadRawEffectiveConfig(registration.getDefaultConfig(), pluginId));
    }

    public synchronized PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        PluginRegistration registration = requireRegistration(pluginId);
        Map<String, Object> normalized = PluginConfigManager.normalizeConfig(config);
        Map<String, Object> effectiveConfig = configManager.resolveRuntimeConfig(registration.getDefaultConfig(), normalized);
        ActionDockPlugin plugin = findLoadedExtension(pluginId);
        if (plugin != null) {
            plugin.validateConfig(effectiveConfig);
        }
        configManager.writeConfig(pluginId, normalized);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(configManager.loadRawEffectiveConfig(registration.getDefaultConfig(), pluginId));
    }

    public synchronized PluginView install(String originalFilename, byte[] content) {
        return install(originalFilename, content, null, null, null);
    }

    public synchronized PluginView installFromRepository(String originalFilename,
                                                         byte[] content,
                                                         String repositoryId,
                                                         String repositoryPluginId,
                                                         String repositoryVersion) {
        return install(originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion);
    }

    private synchronized PluginView install(String originalFilename,
                                            byte[] content,
                                            String repositoryId,
                                            String repositoryPluginId,
                                            String repositoryVersion) {
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
            assertRepositoryVersion(repositoryVersion, manifest);
            if (pluginRegistryRepository.findByPluginId(pluginId).isPresent()) {
                throw new IllegalArgumentException("插件已存在: " + pluginId);
            }
            PluginRegistration saved = pluginRegistryRepository.save(
                    PluginViewMapper.toRegistration(manifest, destination.getFileName().toString(), true, null)
                            .setRepositoryId(repositoryId)
                            .setRepositoryPluginId(repositoryPluginId)
                            .setRepositoryVersion(repositoryVersion)
            );
            return viewMapper.toPluginView(saved, pluginManager);
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
        return upgrade(pluginId, originalFilename, content, null, null, null);
    }

    public synchronized PluginView upgradeFromRepository(String pluginId,
                                                         String originalFilename,
                                                         byte[] content,
                                                         String repositoryId,
                                                         String repositoryPluginId,
                                                         String repositoryVersion) {
        return upgrade(pluginId, originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion);
    }

    private synchronized PluginView upgrade(String pluginId,
                                            String originalFilename,
                                            byte[] content,
                                            String repositoryId,
                                            String repositoryPluginId,
                                            String repositoryVersion) {
        ensureEnabled();
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("插件文件不能为空");
        }
        PluginRegistration current = requireRegistration(pluginId);
        PluginRegistration backup = PluginViewMapper.cloneRegistration(current);
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
            assertRepositoryVersion(repositoryVersion, manifest);
            saved = pluginRegistryRepository.save(
                    PluginViewMapper.toRegistration(manifest, destination.getFileName().toString(), wasEnabled, backup)
                            .setRepositoryId(repositoryId)
                            .setRepositoryPluginId(repositoryPluginId)
                            .setRepositoryVersion(repositoryVersion)
            );
            if (!wasEnabled) {
                unloadIfLoaded(pluginId);
            }
            if (!oldPluginPath.equals(destination)) {
                Files.deleteIfExists(oldPluginPath);
            }
            return viewMapper.toPluginView(saved, pluginManager);
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

    public synchronized PluginRegistration getRegistration(String pluginId) {
        return PluginViewMapper.cloneRegistration(requireRegistration(pluginId));
    }

    public synchronized byte[] readPluginFile(String pluginId) {
        PluginRegistration registration = requireRegistration(pluginId);
        try {
            return Files.readAllBytes(resolvePluginPath(registration));
        } catch (IOException exception) {
            throw new PluginRuntimeException("读取插件文件失败: " + pluginId, exception);
        }
    }

    public synchronized PluginView start(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        PluginManifest manifest = loadRegisteredPlugin(registration);
        PluginRegistration saved = pluginRegistryRepository.save(
                PluginViewMapper.toRegistration(manifest, registration.getFileName(), true, registration)
        );
        return viewMapper.toPluginView(saved, pluginManager);
    }

    public synchronized PluginView stop(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        unloadIfLoaded(pluginId);
        PluginRegistration saved = pluginRegistryRepository.save(
                PluginViewMapper.cloneRegistration(registration)
                        .setEnabled(false)
                        .setUpdatedAt(LocalDateTime.now())
        );
        return viewMapper.toPluginView(saved, pluginManager);
    }

    public synchronized void uninstall(String pluginId, boolean force) {
        ensureEnabled();
        if (!force) {
            List<String> dependentScripts = findDependentScripts(pluginId);
            if (!dependentScripts.isEmpty()) {
                throw new IllegalArgumentException("插件仍被工具依赖，不能卸载: " + String.join(", ", dependentScripts));
            }
        }
        PluginRegistration registration = requireRegistration(pluginId);
        unloadIfLoaded(pluginId);
        deletePluginFile(registration);
        pluginRegistryRepository.deleteByPluginId(pluginId);
        manifestCache.remove(pluginId);
        configManager.deleteConfig(pluginId);
    }

    private List<String> findDependentScripts(String pluginId) {
        if (scriptRepository == null) {
            return List.of();
        }
        return scriptRepository.findAll().stream()
                .filter(script -> script.getPluginDependencies().stream()
                        .anyMatch(dependency -> pluginId.equals(dependency.getPluginId())))
                .map(script -> script.getId())
                .toList();
    }

    public synchronized void assertActionAvailable(String pluginId, String action) {
        if (systemPlugins.containsKey(pluginId)) {
            return;
        }
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
        try {
            ActionDockPlugin systemPlugin = systemPlugins.get(pluginId);
            if (systemPlugin != null) {
                return systemPlugin.invoke(
                        action,
                        new ScriptPluginContext()
                                .setScriptId(definition == null ? null : definition.getId())
                                .setScriptName(definition == null ? null : definition.getName())
                                .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                                .setSubmitMode(resolveSubmitMode(executionContext))
                                .setScriptInput(input)
                                .setPluginConfig(Map.of()),
                        args == null ? Map.of() : new LinkedHashMap<>(args)
                );
            }
            PluginRegistration registration = requireRegistration(pluginId);
            ActionDockPlugin plugin = requireLoadedExtension(pluginId);
            return plugin.invoke(
                    action,
                    new ScriptPluginContext()
                            .setScriptId(definition == null ? null : definition.getId())
                            .setScriptName(definition == null ? null : definition.getName())
                            .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                            .setSubmitMode(resolveSubmitMode(executionContext))
                            .setScriptInput(input)
                            .setPluginConfig(configManager.loadRuntimeConfig(registration.getDefaultConfig(), pluginId)),
                    args == null ? Map.of() : new LinkedHashMap<>(args)
            );
        } catch (PluginRuntimeException exception) {
            throw enrichPluginInvocationException(pluginId, action, exception);
        } catch (Exception exception) {
            throw enrichPluginInvocationException(pluginId, action, exception);
        }
    }

    public synchronized PluginInvokeView invokeForDebug(String pluginId,
                                                        String action,
                                                        Map<String, Object> args,
                                                        Map<String, Object> scriptInput,
                                                        boolean includeDebug) {
        PluginRegistration registration = requireRegistration(pluginId);
        PluginActionMetadata actionMetadata = requireActionMetadata(registration, action);
        Map<String, Object> normalizedArgs = configValueApplicationService.resolveMap(args);
        Map<String, Object> normalizedScriptInput = configValueApplicationService.resolveMap(scriptInput);
        Map<String, Object> pluginResult = normalizeResult(
                invoke(
                        pluginId,
                        action,
                        null,
                        new ScriptExecutionContext()
                                .setSubmitMode(SubmitMode.SYNC)
                                .setConfig(configValueApplicationService.snapshot()),
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
        } catch (IOException e) {
            throw new IllegalStateException("Cannot initialize plugin directories", e);
        }
        pluginRegistryRepository.findEnabled().forEach(registration -> {
            try {
                PluginManifest manifest = loadRegisteredPlugin(registration);
                pluginRegistryRepository.save(
                        PluginViewMapper.toRegistration(manifest, registration.getFileName(), true, registration)
                );
            } catch (Exception e) {
                LOGGER.log(Level.WARNING, "Failed to load plugin on startup: " + registration.getPluginId(), e);
            }
        });
    }

    private String resolveSubmitMode(ScriptExecutionContext executionContext) {
        SubmitMode submitMode = executionContext == null ? null : executionContext.getSubmitMode();
        return submitMode == null ? null : submitMode.name();
    }

    private PluginRuntimeException enrichPluginInvocationException(String pluginId, String action, Exception exception) {
        String prefix = "插件调用失败 " + pluginId + "/" + action + ": ";
        String message = ErrorDetailSupport.summarize(exception);
        if (message.startsWith(prefix) && exception instanceof PluginRuntimeException pluginRuntimeException) {
            return pluginRuntimeException;
        }
        return new PluginRuntimeException(
                message.startsWith(prefix) ? message : prefix + message,
                exception
        );
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

    private ActionDockPlugin requireLoadedExtension(String pluginId) {
        ActionDockPlugin extension = findLoadedExtension(pluginId);
        if (extension == null) {
            throw new IllegalArgumentException("插件未加载到 JVM: " + pluginId);
        }
        return extension;
    }

    private ActionDockPlugin findLoadedExtension(String pluginId) {
        return pluginManager.getExtensions(ActionDockPlugin.class, pluginId).stream()
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
        ActionDockPlugin extension = requireLoadedExtension(pluginId);
        String declaredPluginId = extension.id();
        if (declaredPluginId == null || declaredPluginId.isBlank()) {
            throw new IllegalArgumentException("插件 ID 不能为空: " + pluginId);
        }
        if (!pluginId.equals(declaredPluginId)) {
            throw new IllegalArgumentException("插件扩展 ID 不匹配: " + pluginId);
        }
        PluginManifest manifest = org.team4u.actiondock.plugin.api.PluginManifestLoader.load(extension.getClass(), pluginId);
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

    private void assertRepositoryVersion(String expectedVersion, PluginManifest manifest) {
        if (expectedVersion != null && !expectedVersion.isBlank() && !expectedVersion.equals(manifest.getVersion())) {
            throw new IllegalArgumentException("插件版本与仓库描述不一致: " + manifest.getVersion());
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
