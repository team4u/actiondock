package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginState;
import org.pf4j.PluginWrapper;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.MapValueConverter;
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
import org.team4u.actiondock.shared.NormalizeUtils;

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
import java.util.Optional;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 插件运行时服务，管理插件的完整生命周期。
 * <p>
 * 基于 PF4J 框架提供插件的安装、启停、卸载、配置管理和动作调用能力。
 * 配置管理委托给 {@link PluginConfigManager}，视图映射委托给 {@link PluginViewMapper}。
 * <p>
 * 使用 {@link ReentrantReadWriteLock} 替代 synchronized，读操作（查询、调用）并发执行，
 * 写操作（安装、升级、卸载、启停）互斥执行。
 *
 * @author jay.wu
 */
public class PluginRuntimeService {
    private static final Logger LOGGER = LoggerFactory.getLogger(PluginRuntimeService.class);
    private static final PluginRuntimeService DISABLED = new PluginRuntimeService();

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private final PluginRegistryRepository pluginRegistryRepository;
    private final ScriptRepository scriptRepository;
    private final Path pluginsRoot;
    private final PluginFileManager fileManager;
    private final DefaultPluginManager pluginManager;
    private final Map<String, ActionDockPlugin> systemPlugins;
    private final Map<String, PluginManifest> manifestCache;
    private final ConfigValueApplicationService configValueApplicationService;
    private final PluginConfigManager configManager;
    private final boolean enabled;

    private PluginRuntimeService() {
        this.pluginRegistryRepository = null;
        this.scriptRepository = null;
        this.pluginsRoot = null;
        this.fileManager = null;
        this.pluginManager = null;
        this.systemPlugins = Map.of();
        this.manifestCache = Map.of();
        this.configValueApplicationService = ConfigValueApplicationService.disabled();
        this.configManager = null;
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
        this.pluginsRoot = NormalizeUtils.normalizePath(Path.of(properties == null || NormalizeUtils.isBlank(properties.getDir())
                ? AppProperties.defaultPluginsDir()
                : properties.getDir()));
        this.fileManager = new PluginFileManager(this.pluginsRoot);
        Path configRoot = this.pluginsRoot.resolve(".actiondock-config");
        this.pluginManager = new DefaultPluginManager(this.pluginsRoot);
        this.systemPlugins = systemPlugins == null ? Map.of() : systemPlugins.stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(ActionDockPlugin::id, plugin -> plugin));
        this.manifestCache = new HashMap<>();
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
        this.configManager = new PluginConfigManager(jsonCodec, configRoot, configValueApplicationService);
        this.enabled = true;
        initialize();
    }

    public static PluginRuntimeService disabled() {
        return DISABLED;
    }

    public List<PluginView> list() {
        if (!enabled) {
            return List.of();
        }
        return withReadLock(lock, () -> pluginRegistryRepository.findAll().stream()
                .sorted(Comparator.comparing(PluginRegistration::getPluginId))
                .map(reg -> PluginViewMapper.toPluginView(reg, pluginManager))
                .toList());
    }

    public List<PluginReferenceView> listPluginReferences() {
        if (!enabled) {
            return List.of();
        }
        return withReadLock(lock, () -> {
            List<PluginReferenceView> references = new ArrayList<>();
            pluginRegistryRepository.findAll().stream()
                    .filter(registration -> isLoadedAndStarted(registration.getPluginId()))
                    .sorted(Comparator.comparing(PluginRegistration::getPluginId))
                    .map(PluginViewMapper::toInstalledPluginReferenceView)
                    .forEach(references::add);
            systemPlugins.entrySet().stream()
                    .sorted(Map.Entry.comparingByKey())
                    .map(entry -> PluginViewMapper.toSystemPluginReferenceView(entry.getKey(), entry.getValue()))
                    .filter(Objects::nonNull)
                    .forEach(references::add);
            return references.stream()
                    .sorted(Comparator.comparing(PluginReferenceView::getPluginId))
                    .toList();
        });
    }

    public PluginView get(String pluginId) {
        return withReadLock(lock, () -> PluginViewMapper.toPluginView(requireRegistration(pluginId), pluginManager));
    }

    public PluginConfigView getConfig(String pluginId) {
        return withReadLock(lock, () -> buildConfigView(pluginId, requireRegistration(pluginId)));
    }

    public PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        return withWriteLock(lock, () -> {
            PluginRegistration registration = requireRegistration(pluginId);
            Map<String, Object> normalized = PluginConfigManager.normalizeConfig(config);
            Map<String, Object> effectiveConfig = configManager.resolveRuntimeConfig(registration.getDefaultConfig(), normalized);
            ActionDockPlugin plugin = findLoadedExtension(pluginId);
            if (plugin != null) {
                plugin.validateConfig(effectiveConfig);
            }
            configManager.writeConfig(pluginId, normalized);
            return buildConfigView(pluginId, registration);
        });
    }

    private PluginConfigView buildConfigView(String pluginId, PluginRegistration registration) {
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(configManager.loadRawEffectiveConfig(registration.getDefaultConfig(), pluginId));
    }

    public PluginView install(String originalFilename, byte[] content) {
        return install(originalFilename, content, null, null, null);
    }

    public PluginView installFromRepository(String originalFilename,
                                             byte[] content,
                                             String repositoryId,
                                             String repositoryPluginId,
                                             String repositoryVersion) {
        return install(originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion);
    }

    /**
     * 持久化插件文件并加载到运行时。
     * <p>
     * 包含通用的空内容校验、文件写入、插件加载、缓存和版本校验逻辑，
     * 供 install 和 upgrade 流程复用。
     *
     * @param content           插件文件内容
     * @param destination       目标写入路径
     * @param repositoryVersion 预期的仓库版本号，用于版本一致性校验
     * @return 加载后的插件 ID
     */
    private String persistPluginArtifact(byte[] content, Path destination, String repositoryVersion) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("插件文件不能为空");
        }
        try {
            Files.createDirectories(pluginsRoot);
            Files.write(destination, content);
        } catch (IOException exception) {
            throw new IllegalStateException("写入插件文件失败: " + destination.getFileName(), exception);
        }
        String pluginId = loadPlugin(destination);
        PluginManifest manifest = cacheManifest(pluginId);
        if (NormalizeUtils.isNotBlank(repositoryVersion) && !repositoryVersion.equals(manifest.getVersion())) {
            throw new IllegalArgumentException("插件版本与仓库描述不一致: " + manifest.getVersion());
        }
        return pluginId;
    }

    private PluginView install(String originalFilename,
                               byte[] content,
                               String repositoryId,
                               String repositoryPluginId,
                               String repositoryVersion) {
        return withWriteLock(lock, () -> {
            ensureEnabled();
            String fileName = fileManager.sanitizeFilename(originalFilename);
            Path destination = fileManager.uniquePluginPath(fileName);
            String pluginId = null;
            try {
                pluginId = persistPluginArtifact(content, destination, repositoryVersion);
                if (pluginRegistryRepository.findByPluginId(pluginId).isPresent()) {
                    throw new IllegalArgumentException("插件已存在: " + pluginId);
                }
                PluginRegistration saved = saveRegistration(pluginId, destination.getFileName().toString(), true, null, repositoryId, repositoryPluginId, repositoryVersion);
                return PluginViewMapper.toPluginView(saved, pluginManager);
            } catch (Exception exception) {
                cleanupFailedInstall(pluginId, destination);
                throw exception instanceof PluginRuntimeException re ? re
                        : new PluginRuntimeException("安装插件失败: " + exception.getMessage(), exception);
            }
        });
    }

    private PluginRegistration saveRegistration(String pluginId, String fileName,
                                                boolean enabled, PluginRegistration previous,
                                                String repositoryId, String repositoryPluginId, String repositoryVersion) {
        PluginManifest manifest = manifestCache.get(pluginId);
        return pluginRegistryRepository.save(
                PluginViewMapper.toRegistration(manifest, fileName, enabled, previous)
                        .setRepositoryId(repositoryId)
                        .setRepositoryPluginId(repositoryPluginId)
                        .setRepositoryVersion(repositoryVersion)
        );
    }

    private void cleanupFailedInstall(String pluginId, Path destination) {
        if (pluginId != null) {
            unloadIfLoaded(pluginId);
        }
        try {
            Files.deleteIfExists(destination);
        } catch (IOException e) {
            LOGGER.warn("清理安装失败的插件文件失败: {}", destination, e);
        }
    }

    public PluginView upgrade(String pluginId, String originalFilename, byte[] content) {
        return upgrade(pluginId, originalFilename, content, null, null, null);
    }

    public PluginView upgradeFromRepository(String pluginId,
                                             String originalFilename,
                                             byte[] content,
                                             String repositoryId,
                                             String repositoryPluginId,
                                             String repositoryVersion) {
        return upgrade(pluginId, originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion);
    }

    private PluginView upgrade(String pluginId,
                               String originalFilename,
                               byte[] content,
                               String repositoryId,
                               String repositoryPluginId,
                               String repositoryVersion) {
        return withWriteLock(lock, () -> {
            ensureEnabled();
            PluginRegistration current = requireRegistration(pluginId);
            PluginRegistration backup = current.copy();
            Path oldPluginPath = fileManager.resolvePluginPath(current);
            boolean wasEnabled = current.isEnabled();
            return performUpgrade(pluginId, originalFilename, content, repositoryId, repositoryPluginId,
                    repositoryVersion, backup, oldPluginPath, wasEnabled);
        });
    }

    private PluginView performUpgrade(String pluginId,
                                      String originalFilename,
                                      byte[] content,
                                      String repositoryId,
                                      String repositoryPluginId,
                                      String repositoryVersion,
                                      PluginRegistration backup,
                                      Path oldPluginPath,
                                      boolean wasEnabled) {
        Path destination = fileManager.uniquePluginPath(fileManager.sanitizeFilename(originalFilename));
        String loadedPluginId = null;
        PluginRegistration saved = null;
        try {
            unloadIfLoaded(pluginId);
            loadedPluginId = persistPluginArtifact(content, destination, repositoryVersion);
            if (!pluginId.equals(loadedPluginId)) {
                throw new IllegalArgumentException("插件 ID 与升级目标不一致: " + loadedPluginId);
            }
            saved = saveRegistration(pluginId, destination.getFileName().toString(), wasEnabled, backup, repositoryId, repositoryPluginId, repositoryVersion);
            if (!wasEnabled) {
                unloadIfLoaded(pluginId);
            }
            if (!oldPluginPath.equals(destination)) {
                Files.deleteIfExists(oldPluginPath);
            }
            return PluginViewMapper.toPluginView(saved, pluginManager);
        } catch (Exception exception) {
            throw rollbackUpgrade(pluginId, loadedPluginId, destination, saved, backup, wasEnabled, exception);
        }
    }

    private PluginRuntimeException rollbackUpgrade(String pluginId,
                                  String loadedPluginId,
                                  Path destination,
                                  PluginRegistration saved,
                                  PluginRegistration backup,
                                  boolean wasEnabled,
                                  Exception cause) {
        cleanupFailedInstall(loadedPluginId, destination);
        if (saved != null) {
            pluginRegistryRepository.save(backup);
        }
        if (wasEnabled) {
            try {
                loadRegisteredPlugin(backup);
            } catch (Exception rollbackException) {
                LOGGER.error("插件回滚失败，系统可能处于不一致状态: {}", pluginId, rollbackException);
            }
        }
        return new PluginRuntimeException("升级插件失败: " + cause.getMessage(), cause);
    }

    public Optional<PluginRegistration> findPluginRegistration(String pluginId) {
        return withReadLock(lock, () -> pluginRegistryRepository.findByPluginId(pluginId)
                .map(PluginRegistration::copy));
    }

    public PluginRegistration getRegistration(String pluginId) {
        return withReadLock(lock, () -> requireRegistration(pluginId).copy());
    }

    public byte[] readPluginFile(String pluginId) {
        return withReadLock(lock, () -> {
            try {
                PluginRegistration registration = requireRegistration(pluginId);
                return Files.readAllBytes(fileManager.resolvePluginPath(registration));
            } catch (IOException exception) {
                throw new PluginRuntimeException("读取插件文件失败: " + pluginId, exception);
            }
        });
    }

    public PluginView start(String pluginId) {
        return withWriteLock(lock, () -> {
            ensureEnabled();
            PluginRegistration registration = requireRegistration(pluginId);
            loadRegisteredPlugin(registration);
            PluginRegistration saved = saveRegistration(pluginId, registration.getFileName(), true, registration, null, null, null);
            return PluginViewMapper.toPluginView(saved, pluginManager);
        });
    }

    public PluginView stop(String pluginId) {
        return withWriteLock(lock, () -> {
            ensureEnabled();
            PluginRegistration registration = requireRegistration(pluginId);
            unloadIfLoaded(pluginId);
            PluginRegistration saved = pluginRegistryRepository.save(
                    registration.copy()
                            .setEnabled(false)
                            .setUpdatedAt(LocalDateTime.now())
            );
            return PluginViewMapper.toPluginView(saved, pluginManager);
        });
    }

    public void uninstall(String pluginId, boolean force) {
        withWriteLock(lock, () -> {
            ensureEnabled();
            if (!force && scriptRepository != null) {
                List<String> dependentScripts = scriptRepository.findAll().stream()
                        .filter(script -> script.getPluginDependencies().stream()
                                .anyMatch(dependency -> pluginId.equals(dependency.getPluginId())))
                        .map(ScriptDefinition::getId)
                        .toList();
                if (!dependentScripts.isEmpty()) {
                    throw new IllegalArgumentException("插件仍被工具依赖，不能卸载: " + String.join(", ", dependentScripts));
                }
            }
            PluginRegistration registration = requireRegistration(pluginId);
            unloadIfLoaded(pluginId);
            fileManager.deletePluginFile(registration);
            pluginRegistryRepository.deleteByPluginId(pluginId);
            manifestCache.remove(pluginId);
            configManager.deleteConfig(pluginId);
        });
    }

    private void assertActionAvailable(String pluginId, String action) {
        withReadLock(lock, () -> {
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
        });
    }

    public Object invoke(String pluginId,
                         String action,
                         ScriptDefinition definition,
                         ScriptExecutionContext executionContext,
                         Map<String, Object> input,
                         Map<String, Object> args) {
        return withReadLock(lock, () -> {
            assertActionAvailable(pluginId, action);
            return doInvoke(pluginId, action, definition, executionContext, input, args);
        });
    }

    public PluginInvokeView invokeForDebug(String pluginId,
                                           String action,
                                           Map<String, Object> args,
                                           Map<String, Object> scriptInput,
                                           boolean includeDebug) {
        return withReadLock(lock, () -> {
            PluginRegistration registration = requireRegistration(pluginId);
            PluginActionMetadata actionMetadata = requireActionMetadata(registration, action);
            Map<String, Object> normalizedArgs = configValueApplicationService.resolveMap(args);
            Map<String, Object> normalizedScriptInput = configValueApplicationService.resolveMap(scriptInput);
            Map<String, Object> pluginResult = MapValueConverter.toResultMap(
                    doInvoke(pluginId, action, null,
                            new ScriptExecutionContext()
                                    .setSubmitMode(SubmitMode.SYNC)
                                    .setConfig(configValueApplicationService.snapshot()),
                            normalizedScriptInput, normalizedArgs)
            );
            return new PluginInvokeView()
                    .setPluginId(pluginId)
                    .setAction(action)
                    .setResult(ExecutionOutputProjector.project(pluginResult, actionMetadata.getOutputSchema()))
                    .setDebug(includeDebug
                            ? new PluginInvokeDebugView()
                            .setArgs(normalizedArgs)
                            .setScriptInput(normalizedScriptInput)
                            : null);
        });
    }

    private Object doInvoke(String pluginId,
                            String action,
                            ScriptDefinition definition,
                            ScriptExecutionContext executionContext,
                            Map<String, Object> input,
                            Map<String, Object> args) {
        try {
            ActionDockPlugin systemPlugin = systemPlugins.get(pluginId);
            ActionDockPlugin plugin;
            Map<String, Object> pluginConfig;

            if (systemPlugin != null) {
                plugin = systemPlugin;
                pluginConfig = Map.of();
            } else {
                PluginRegistration registration = requireRegistration(pluginId);
                plugin = requireLoadedExtension(pluginId);
                pluginConfig = configManager.loadRuntimeConfig(registration.getDefaultConfig(), pluginId);
            }

            ScriptPluginContext context = new ScriptPluginContext()
                    .setScriptId(definition == null ? null : definition.getId())
                    .setScriptName(definition == null ? null : definition.getName())
                    .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                    .setSubmitMode(resolveSubmitMode(executionContext))
                    .setScriptInput(input)
                    .setPluginConfig(pluginConfig);

            return plugin.invoke(action, context, args == null ? Map.of() : new LinkedHashMap<>(args));
        } catch (Exception exception) {
            throw enrichPluginInvocationException(pluginId, action, exception);
        }
    }

    private void initialize() {
        try {
            Files.createDirectories(pluginsRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot initialize plugin directories", e);
        }
        pluginRegistryRepository.findEnabled().forEach(registration -> {
            try {
                loadRegisteredPlugin(registration);
                saveRegistration(registration.getPluginId(), registration.getFileName(), true, registration, null, null, null);
            } catch (Exception e) {
                LOGGER.warn("Failed to load plugin on startup: {}", registration.getPluginId(), e);
            }
        });
    }

    private static String resolveSubmitMode(ScriptExecutionContext executionContext) {
        SubmitMode submitMode = executionContext == null ? null : executionContext.getSubmitMode();
        return submitMode == null ? null : submitMode.name();
    }

    private static PluginRuntimeException enrichPluginInvocationException(String pluginId, String action, Exception exception) {
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
        Path pluginPath = fileManager.resolvePluginPath(registration);
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
        startPlugin(registration.getPluginId());
        return cacheManifest(registration.getPluginId());
    }

    private String loadPlugin(Path pluginPath) {
        String pluginId = pluginManager.loadPlugin(pluginPath);
        if (NormalizeUtils.isBlank(pluginId)) {
            throw new IllegalStateException("插件加载失败，未返回 pluginId");
        }
        startPlugin(pluginId);
        return pluginId;
    }

    private void startPlugin(String pluginId) {
        PluginState state = pluginManager.startPlugin(pluginId);
        if (!state.isStarted()) {
            throw new IllegalStateException("插件启动失败: " + pluginId);
        }
    }

    private PluginManifest cacheManifest(String pluginId) {
        ActionDockPlugin extension = requireLoadedExtension(pluginId);
        String declaredPluginId = extension.id();
        if (NormalizeUtils.isBlank(declaredPluginId)) {
            throw new IllegalArgumentException("插件 ID 不能为空: " + pluginId);
        }
        if (!pluginId.equals(declaredPluginId)) {
            throw new IllegalArgumentException("插件扩展 ID 不匹配: " + pluginId);
        }
        PluginManifest manifest = org.team4u.actiondock.plugin.api.PluginManifestLoader.load(extension.getClass(), pluginId);
        if (manifest == null) {
            throw new IllegalArgumentException("插件描述不能为空: " + pluginId);
        }
        if (NormalizeUtils.isBlank(manifest.getPluginId())) {
            manifest.setPluginId(pluginId);
        }
        if (!pluginId.equals(manifest.getPluginId())) {
            throw new IllegalArgumentException("插件描述 pluginId 不匹配: " + pluginId);
        }
        manifestCache.put(pluginId, manifest);
        return manifest;
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

    private void ensureEnabled() {
        if (!enabled) {
            throw new IllegalStateException("插件运行时未启用");
        }
    }

    private static <T> T withReadLock(ReentrantReadWriteLock lock, java.util.function.Supplier<T> action) {
        lock.readLock().lock();
        try {
            return action.get();
        } finally {
            lock.readLock().unlock();
        }
    }

    private static void withReadLock(ReentrantReadWriteLock lock, Runnable action) {
        lock.readLock().lock();
        try {
            action.run();
        } finally {
            lock.readLock().unlock();
        }
    }

    private static void withWriteLock(ReentrantReadWriteLock lock, Runnable action) {
        lock.writeLock().lock();
        try {
            action.run();
        } finally {
            lock.writeLock().unlock();
        }
    }

    private static <T> T withWriteLock(ReentrantReadWriteLock lock, java.util.function.Supplier<T> action) {
        lock.writeLock().lock();
        try {
            return action.get();
        } finally {
            lock.writeLock().unlock();
        }
    }
}
