package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginState;
import org.pf4j.PluginWrapper;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionOutputProjector;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

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

/**
 * 插件运行时服务，管理插件的完整生命周期。
 * <p>
 * 基于 PF4J 框架提供插件的安装、启停、卸载、配置管理和动作调用能力。
 *
 * @author jay.wu
 */
public class PluginRuntimeService {
    private static final PluginRuntimeService DISABLED = new PluginRuntimeService();

    private final JsonCodec jsonCodec;
    private final PluginRegistryRepository pluginRegistryRepository;
    private final Path pluginsRoot;
    private final Path configRoot;
    private final DefaultPluginManager pluginManager;
    private final Map<String, ActionDockPlugin> systemPlugins;
    private final Map<String, PluginManifest> manifestCache;
    private final ExecutionOutputProjector executionOutputProjector;
    private final ConfigValueApplicationService configValueApplicationService;
    private final boolean enabled;

    private PluginRuntimeService() {
        this.jsonCodec = null;
        this.pluginRegistryRepository = null;
        this.pluginsRoot = null;
        this.configRoot = null;
        this.pluginManager = null;
        this.systemPlugins = Map.of();
        this.manifestCache = Map.of();
        this.executionOutputProjector = null;
        this.configValueApplicationService = ConfigValueApplicationService.disabled();
        this.enabled = false;
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties) {
        this(jsonCodec, pluginRegistryRepository, properties, ConfigValueApplicationService.disabled());
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties,
                                ConfigValueApplicationService configValueApplicationService) {
        this(jsonCodec, pluginRegistryRepository, properties, configValueApplicationService, List.of());
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                AppProperties.Plugins properties,
                                ConfigValueApplicationService configValueApplicationService,
                                List<ActionDockPlugin> systemPlugins) {
        this.jsonCodec = jsonCodec;
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.pluginsRoot = Path.of(properties == null || properties.getDir() == null || properties.getDir().isBlank()
                ? AppProperties.defaultPluginsDir()
                : properties.getDir()).toAbsolutePath().normalize();
        this.configRoot = this.pluginsRoot.resolve(".actiondock-config");
        this.pluginManager = new DefaultPluginManager(this.pluginsRoot);
        this.systemPlugins = systemPlugins == null ? Map.of() : systemPlugins.stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(ActionDockPlugin::id, plugin -> plugin));
        this.manifestCache = new HashMap<>();
        this.executionOutputProjector = new ExecutionOutputProjector();
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
        this.enabled = true;
        initialize();
    }

    /**
     * 获取禁用状态的插件运行时服务单例。
     * <p>
     * 当插件功能未启用时，所有操作将返回空结果或抛出异常。
     *
     * @return 禁用状态的插件运行时服务实例
     */
    public static PluginRuntimeService disabled() {
        return DISABLED;
    }

    /**
     * 获取所有已注册插件的列表。
     * <p>
     * 按插件 ID 升序排列，返回每个插件的概要信息（ID、名称、版本、状态、动作列表等）。
     * 若插件运行时未启用，返回空列表。
     *
     * @return 插件视图列表，不会返回 null
     */
    public synchronized List<PluginView> list() {
        if (!enabled) {
            return List.of();
        }
        return pluginRegistryRepository.findAll().stream()
                .sorted(Comparator.comparing(PluginRegistration::getPluginId))
                .map(this::toPluginView)
                .toList();
    }

    /**
     * 获取指定插件的概要信息。
     *
     * @param pluginId 插件唯一标识
     * @return 插件视图，包含状态、版本、动作列表等信息
     * @throws IllegalArgumentException 如果插件不存在
     */
    public synchronized PluginView get(String pluginId) {
        return toPluginView(requireRegistration(pluginId));
    }

    /**
     * 获取指定插件的配置信息。
     * <p>
     * 返回配置模式（configSchema）、默认配置和当前生效配置的合并结果。
     *
     * @param pluginId 插件唯一标识
     * @return 插件配置视图，包含模式定义、默认值和生效配置
     * @throws IllegalArgumentException 如果插件不存在
     */
    public synchronized PluginConfigView getConfig(String pluginId) {
        PluginRegistration registration = requireRegistration(pluginId);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(loadRawEffectiveConfig(registration));
    }

    /**
     * 保存指定插件的用户配置。
     * <p>
     * 将用户配置与默认配置合并后生成运行时生效配置，并调用已加载的插件实例进行配置校验。
     * 校验通过后持久化到配置文件。
     *
     * @param pluginId 插件唯一标识
     * @param config   用户提交的配置项，会覆盖同名的默认配置
     * @return 更新后的插件配置视图
     * @throws IllegalArgumentException    如果插件不存在
     * @throws PluginRuntimeException      如果配置校验失败或写入文件失败
     */
    public synchronized PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        PluginRegistration registration = requireRegistration(pluginId);
        Map<String, Object> normalized = normalizeConfig(config);
        Map<String, Object> effectiveConfig = resolveRuntimeConfig(registration.getDefaultConfig(), normalized);
        ActionDockPlugin plugin = findLoadedExtension(pluginId);
        if (plugin != null) {
            plugin.validateConfig(effectiveConfig);
        }
        writeConfig(pluginId, normalized);
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(loadRawEffectiveConfig(registration));
    }

    /**
     * 安装插件。
     * <p>
     * 将上传的 JAR 插件文件写入插件目录，加载并启动插件，然后注册到仓库。
     * 安装后插件处于启动状态，可被脚本调用。若安装失败会自动回滚（卸载插件、删除文件）。
     *
     * @param originalFilename 上传文件的原始文件名，必须以 .jar 结尾
     * @param content          插件 JAR 文件的字节数据
     * @return 安装后的插件视图
     * @throws IllegalArgumentException    如果文件为空或插件已存在
     * @throws PluginRuntimeException      如果插件加载、启动或注册失败
     */
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
                    toRegistration(manifest, destination.getFileName().toString(), true, null)
                            .setRepositoryId(repositoryId)
                            .setRepositoryPluginId(repositoryPluginId)
                            .setRepositoryVersion(repositoryVersion)
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

    /**
     * 升级插件到新版本。
     * <p>
     * 先卸载旧版本插件，写入新的 JAR 文件并加载启动，同时更新注册信息。
     * 升级后保留原插件的启停状态。若升级失败会自动回滚到旧版本。
     *
     * @param pluginId         目标插件的唯一标识，新插件的 ID 必须与其一致
     * @param originalFilename 新版本 JAR 文件的原始文件名
     * @param content          新版本插件的字节数据
     * @return 升级后的插件视图
     * @throws IllegalArgumentException    如果文件为空或插件 ID 不一致
     * @throws PluginRuntimeException      如果升级过程失败
     */
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
            assertRepositoryVersion(repositoryVersion, manifest);
            saved = pluginRegistryRepository.save(mergeRegistrationWithFileName(backup, manifest, destination.getFileName().toString())
                    .setRepositoryId(repositoryId)
                    .setRepositoryPluginId(repositoryPluginId)
                    .setRepositoryVersion(repositoryVersion));

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

    public synchronized PluginRegistration getRegistration(String pluginId) {
        return cloneRegistration(requireRegistration(pluginId));
    }

    public synchronized byte[] readPluginFile(String pluginId) {
        PluginRegistration registration = requireRegistration(pluginId);
        try {
            return Files.readAllBytes(resolvePluginPath(registration));
        } catch (IOException exception) {
            throw new PluginRuntimeException("读取插件文件失败: " + pluginId, exception);
        }
    }

    /**
     * 启动插件。
     * <p>
     * 从文件系统加载插件 JAR 并启动，同时更新注册信息中的启用状态和插件元数据（如动作列表）。
     *
     * @param pluginId 插件唯一标识
     * @return 启动后的插件视图
     * @throws IllegalArgumentException 如果插件不存在或文件缺失
     * @throws IllegalStateException    如果插件启动失败
     */
    public synchronized PluginView start(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        PluginManifest manifest = loadRegisteredPlugin(registration);
        PluginRegistration saved = pluginRegistryRepository.save(
                mergeRegistration(registration, manifest, true)
        );
        return toPluginView(saved);
    }

    /**
     * 停止插件。
     * <p>
     * 停止并卸载 JVM 中的插件实例，同时将注册信息标记为禁用状态。
     * 插件文件和注册记录保留，可再次调用 {@link #start(String)} 重新启动。
     *
     * @param pluginId 插件唯一标识
     * @return 停止后的插件视图
     * @throws IllegalArgumentException 如果插件不存在
     */
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

    /**
     * 卸载插件。
     * <p>
     * 完整移除插件：停止 JVM 中的插件实例、删除插件 JAR 文件、
     * 删除注册记录、清除描述缓存和用户配置文件。
     *
     * @param pluginId 插件唯一标识
     * @throws IllegalArgumentException    如果插件不存在
     * @throws PluginRuntimeException      如果删除文件失败
     */
    public synchronized void uninstall(String pluginId) {
        ensureEnabled();
        PluginRegistration registration = requireRegistration(pluginId);
        unloadIfLoaded(pluginId);
        deletePluginFile(registration);
        pluginRegistryRepository.deleteByPluginId(pluginId);
        manifestCache.remove(pluginId);
        deleteConfig(pluginId);
    }

    /**
     * 断言指定插件动作可用。
     * <p>
     * 检查插件是否已启动并在 JVM 中加载，以及指定动作是否存在于插件的动作列表中。
     * 用于在调用插件前进行前置校验。
     *
     * @param pluginId 插件唯一标识
     * @param action   动作名称
     * @throws IllegalArgumentException 如果插件未启动或动作不存在
     */
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

    /**
     * 调用指定插件的动作。
     * <p>
     * 在脚本执行上下文中调用已启动插件的指定动作，传入脚本输入和插件参数。
     * 自动加载插件的运行时配置并注入到调用上下文中。
     *
     * @param pluginId         插件唯一标识
     * @param action           要调用的动作名称
     * @param definition       当前执行的脚本定义，可为 null
     * @param executionContext 脚本执行上下文，包含执行 ID 和提交模式等信息
     * @param input            脚本层的原始输入数据
     * @param args             传递给插件动作的参数
     * @return 插件动作的返回值
     * @throws IllegalArgumentException 如果插件未启动或动作不存在
     * @throws PluginRuntimeException   如果插件调用过程中发生异常
     */
    public synchronized Object invoke(String pluginId,
                                      String action,
                                      ScriptDefinition definition,
                                      ScriptExecutionContext executionContext,
                                      Map<String, Object> input,
                                      Map<String, Object> args) {
        assertActionAvailable(pluginId, action);
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
        try {
            return plugin.invoke(
                    action,
                    new ScriptPluginContext()
                            .setScriptId(definition == null ? null : definition.getId())
                            .setScriptName(definition == null ? null : definition.getName())
                            .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                            .setSubmitMode(resolveSubmitMode(executionContext))
                            .setScriptInput(input)
                            .setPluginConfig(loadRuntimeConfig(registration)),
                    args == null ? Map.of() : new LinkedHashMap<>(args)
            );
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("插件调用失败 " + pluginId + "/" + action + ": " + exception.getMessage(), exception);
        }
    }

    /**
     * 以调试模式调用插件动作。
     * <p>
     * 用于管理后台的插件调试功能，以同步模式执行插件动作，
     * 并根据输出模式对结果进行投影处理。可选择附带调试信息（实际传入的参数和脚本输入）。
     *
     * @param pluginId     插件唯一标识
     * @param action       要调用的动作名称
     * @param args         传递给插件动作的参数，支持配置变量解析
     * @param scriptInput  模拟的脚本输入数据，支持配置变量解析
     * @param includeDebug 是否在结果中包含调试信息
     * @return 插件调用结果视图，包含投影后的输出和可选的调试信息
     * @throws IllegalArgumentException    如果插件或动作不存在
     * @throws PluginRuntimeException      如果插件调用失败
     */
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

    private void assertRepositoryVersion(String expectedVersion, PluginManifest manifest) {
        if (expectedVersion != null && !expectedVersion.isBlank() && !expectedVersion.equals(manifest.getVersion())) {
            throw new IllegalArgumentException("插件版本与仓库描述不一致: " + manifest.getVersion());
        }
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
                .setRepositoryId(registration.getRepositoryId())
                .setRepositoryPluginId(registration.getRepositoryPluginId())
                .setRepositoryVersion(registration.getRepositoryVersion())
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

    private Map<String, Object> loadRawEffectiveConfig(PluginRegistration registration) {
        return mergeConfig(registration.getDefaultConfig(), readConfig(registration.getPluginId()));
    }

    private Map<String, Object> loadRuntimeConfig(PluginRegistration registration) {
        return resolveRuntimeConfig(registration.getDefaultConfig(), readConfig(registration.getPluginId()));
    }

    private Map<String, Object> resolveRuntimeConfig(Map<String, Object> defaultConfig, Map<String, Object> overrides) {
        return configValueApplicationService.resolveMap(mergeConfig(defaultConfig, overrides));
    }

    private Map<String, Object> mergeConfig(Map<String, Object> defaultConfig, Map<String, Object> overrides) {
        Map<String, Object> merged = normalizeConfig(defaultConfig);
        merged.putAll(normalizeConfig(overrides));
        return merged;
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
