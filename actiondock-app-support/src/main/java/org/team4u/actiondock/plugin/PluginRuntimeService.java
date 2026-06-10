package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginWrapper;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SystemPluginState;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.common.NormalizeUtils;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * 插件运行时服务门面，管理插件的完整生命周期。
 * <p>
 * 基于 PF4J 框架提供插件的安装、启停、卸载、配置管理和动作调用能力。
 * 使用 {@link ReentrantReadWriteLock} 保证线程安全——读操作（查询、调用）并发执行，
 * 写操作（安装、升级、卸载、启停）互斥执行。
 * <p>
 * <b>内部协作：</b>
 * <ul>
 *   <li>{@link PluginLifecycleManager} — 安装/升级/卸载/启停/初始化</li>
 *   <li>{@link PluginInvocationService} — 动作调用/调试调用</li>
 *   <li>{@link PluginQueryService} — 查询/注册/配置管理</li>
 *   <li>{@link PluginSupport} — 共享工具方法和异常工厂</li>
 * </ul>
 * <p>
 * 本类仅负责锁管理和请求路由，业务逻辑全部委托给内部协作类。
 *
 * @author jay.wu
 */
public class PluginRuntimeService {

    private static final PluginRuntimeService DISABLED = new PluginRuntimeService();

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private final DefaultPluginManager pluginManager;
    private final Map<String, ActionDockPlugin> systemPlugins;
    private final Map<String, org.team4u.actiondock.plugin.api.PluginManifest> manifestCache;
    private final PluginConfigManager configManager;
    private final SystemPluginStateRepository systemPluginStateRepository;
    private final boolean enabled;

    private final PluginLifecycleManager lifecycleManager;
    private final PluginInvocationService invocationService;
    private final PluginQueryService queryService;

    /**
     * 禁用状态的空实例构造器。
     */
    private PluginRuntimeService() {
        this.pluginManager = null;
        this.systemPlugins = Map.of();
        this.manifestCache = Map.of();
        this.configManager = null;
        this.systemPluginStateRepository = null;
        this.enabled = false;
        this.lifecycleManager = null;
        this.invocationService = null;
        this.queryService = null;
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
        this(jsonCodec, pluginRegistryRepository, new InMemorySystemPluginStateRepository(), scriptRepository,
                properties, configValueApplicationService, systemPlugins);
    }

    public PluginRuntimeService(JsonCodec jsonCodec,
                                PluginRegistryRepository pluginRegistryRepository,
                                SystemPluginStateRepository systemPluginStateRepository,
                                ScriptRepository scriptRepository,
                                AppProperties.Plugins properties,
                                ConfigValueApplicationService configValueApplicationService,
                                List<ActionDockPlugin> systemPlugins) {
        this.systemPluginStateRepository = systemPluginStateRepository == null
                ? new InMemorySystemPluginStateRepository()
                : systemPluginStateRepository;
        Path pluginsRoot = NormalizeUtils.normalizePath(Path.of(properties == null || NormalizeUtils.isBlank(properties.getDir())
                ? AppProperties.defaultPluginsDir()
                : properties.getDir()));
        this.pluginManager = new DefaultPluginManager(pluginsRoot);
        this.systemPlugins = systemPlugins == null ? Map.of() : systemPlugins.stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(ActionDockPlugin::id, plugin -> plugin));
        this.manifestCache = new HashMap<>();
        ConfigValueApplicationService effectiveConfigService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
        PluginFileManager fileManager = new PluginFileManager(pluginsRoot);
        this.configManager = new PluginConfigManager(jsonCodec, pluginsRoot.resolve(".actiondock-config"), effectiveConfigService);
        this.enabled = true;

        // 创建内部协作类
        this.lifecycleManager = new PluginLifecycleManager(
                this.pluginManager, fileManager, pluginRegistryRepository,
                this.systemPluginStateRepository, scriptRepository,
                this.systemPlugins, this.manifestCache, this.configManager,
                pluginsRoot, this.enabled);
        this.invocationService = new PluginInvocationService(
                this.pluginManager, pluginRegistryRepository,
                this.systemPluginStateRepository, this.systemPlugins,
                this.configManager, effectiveConfigService, this.enabled);
        this.queryService = new PluginQueryService(
                this.pluginManager, pluginRegistryRepository,
                this.systemPluginStateRepository, this.systemPlugins,
                this.configManager, fileManager);

        // 初始化插件运行时
        this.lifecycleManager.initialize();
    }

    /**
     * 获取禁用状态的插件运行时服务单例。
     *
     * @return 禁用实例
     */
    public static PluginRuntimeService disabled() {
        return DISABLED;
    }

    // ==================== 查询与注册（委托 queryService） ====================

    /**
     * 列出所有插件（PF4J 插件和系统插件）的摘要视图。
     *
     * @return 按插件 ID 排序的插件摘要列表
     */
    public List<PluginSummaryView> list() {
        if (!enabled) {
            return List.of();
        }
        return withReadLock(lock, queryService::list);
    }

    public List<PluginReferenceView> listPluginReferences() {
        if (!enabled) {
            return List.of();
        }
        return withReadLock(lock, queryService::listPluginReferences);
    }

    public PluginView get(String pluginId) {
        return withReadLock(lock, () -> queryService.get(pluginId));
    }

    public Optional<PluginRegistration> findPluginRegistration(String pluginId) {
        return withReadLock(lock, () -> queryService.findPluginRegistration(pluginId));
    }

    public PluginRegistration getRegistration(String pluginId) {
        return withReadLock(lock, () -> queryService.getRegistration(pluginId));
    }

    public byte[] readPluginFile(String pluginId) {
        return withReadLock(lock, () -> queryService.readPluginFile(pluginId));
    }

    // ==================== 配置管理（委托 queryService） ====================

    /**
     * 获取插件的默认配置视图。
     *
     * @param pluginId 插件 ID
     * @return 插件配置视图
     */
    public PluginConfigView getConfig(String pluginId) {
        return getConfig(pluginId, PluginConfigManager.DEFAULT_CONFIG_NAME);
    }

    public PluginConfigView getConfig(String pluginId, String configName) {
        return withReadLock(lock, () -> queryService.getConfig(pluginId, configName));
    }

    public List<PluginConfigView> listConfigs(String pluginId) {
        return withReadLock(lock, () -> queryService.listConfigs(pluginId));
    }

    public Map<String, Map<String, Object>> listRawEffectiveConfigs(String pluginId) {
        return withReadLock(lock, () -> queryService.listRawEffectiveConfigs(pluginId));
    }

    public PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        return saveConfig(pluginId, PluginConfigManager.DEFAULT_CONFIG_NAME, config);
    }

    public PluginConfigView saveConfig(String pluginId, String configName, Map<String, Object> config) {
        return withWriteLock(lock, () -> queryService.saveConfig(pluginId, configName, config));
    }

    public void deleteConfig(String pluginId, String configName) {
        withWriteLock(lock, () -> {
            queryService.deleteConfig(pluginId, configName);
            return null;
        });
    }

    // ==================== 生命周期管理（委托 lifecycleManager） ====================

    /**
     * 安装插件。
     *
     * @param originalFilename 原始文件名
     * @param content          插件文件内容
     * @return 安装后的插件视图
     */
    public PluginView install(String originalFilename, byte[] content) {
        return withWriteLock(lock, () -> lifecycleManager.install(originalFilename, content));
    }

    public PluginView installFromRepository(String originalFilename,
                                             byte[] content,
                                             String repositoryId,
                                             String repositoryPluginId,
                                             String repositoryVersion) {
        return withWriteLock(lock, () -> lifecycleManager.installFromRepository(
                originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion));
    }

    public PluginView upgrade(String pluginId, String originalFilename, byte[] content) {
        return withWriteLock(lock, () -> lifecycleManager.upgrade(pluginId, originalFilename, content));
    }

    public PluginView upgradeFromRepository(String pluginId,
                                             String originalFilename,
                                             byte[] content,
                                             String repositoryId,
                                             String repositoryPluginId,
                                             String repositoryVersion) {
        return withWriteLock(lock, () -> lifecycleManager.upgradeFromRepository(
                pluginId, originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion));
    }

    public PluginView start(String pluginId) {
        return withWriteLock(lock, () -> lifecycleManager.start(pluginId));
    }

    public PluginView stop(String pluginId) {
        return withWriteLock(lock, () -> lifecycleManager.stop(pluginId));
    }

    public void uninstall(String pluginId, boolean force) {
        withWriteLock(lock, () -> {
            lifecycleManager.uninstall(pluginId, force);
            return null;
        });
    }

    // ==================== 动作调用（委托 invocationService） ====================

    /**
     * 调用插件动作（使用默认配置名）。
     *
     * @param pluginId         插件 ID
     * @param action           动作名称
     * @param definition       当前执行的脚本定义，可为 null
     * @param executionContext 执行上下文，可为 null
     * @param input            脚本输入参数
     * @param args             动作调用参数
     * @return 动作执行结果
     */
    public Object invoke(String pluginId,
                         String action,
                         ScriptDefinition definition,
                         ScriptExecutionContext executionContext,
                         Map<String, Object> input,
                         Map<String, Object> args) {
        return invoke(pluginId, action, definition, executionContext, input, args,
                PluginConfigManager.DEFAULT_CONFIG_NAME);
    }

    public Object invoke(String pluginId,
                         String action,
                         ScriptDefinition definition,
                         ScriptExecutionContext executionContext,
                         Map<String, Object> input,
                         Map<String, Object> args,
                         String configName) {
        return withReadLock(lock, () -> invocationService.invoke(
                pluginId, action, definition, executionContext, input, args, configName));
    }

    /**
     * 调试模式调用插件动作，返回包含调试信息的视图。
     *
     * @param pluginId     插件 ID
     * @param action       动作名称
     * @param args         动作调用参数
     * @param scriptInput  模拟的脚本输入
     * @param includeDebug 是否包含调试信息
     * @return 插件调用结果视图
     */
    public PluginInvokeView invokeForDebug(String pluginId,
                                           String action,
                                           Map<String, Object> args,
                                           Map<String, Object> scriptInput,
                                           boolean includeDebug) {
        return invokeForDebug(pluginId, action, args, scriptInput, includeDebug,
                PluginConfigManager.DEFAULT_CONFIG_NAME);
    }

    public PluginInvokeView invokeForDebug(String pluginId,
                                           String action,
                                           Map<String, Object> args,
                                           Map<String, Object> scriptInput,
                                           boolean includeDebug,
                                           String configName) {
        return withReadLock(lock, () -> invocationService.invokeForDebug(
                pluginId, action, args, scriptInput, includeDebug, configName));
    }

    // ==================== 包级私有辅助方法（供协作类使用） ====================

    /**
     * 判断系统插件是否已启用。
     *
     * @param pluginId 系统插件 ID
     * @return 是否启用，默认 true
     */
    boolean isSystemPluginEnabled(String pluginId) {
        return systemPluginStateRepository.findByPluginId(pluginId)
                .map(SystemPluginState::isEnabled)
                .orElse(true);
    }

    /**
     * 获取插件的文件系统路径。
     *
     * @param pluginId 插件 ID
     * @return 插件路径
     * @throws IllegalArgumentException 插件未加载
     */
    Path getPluginPath(String pluginId) {
        PluginWrapper wrapper = pluginManager.getPlugin(pluginId);
        if (wrapper == null) {
            throw new IllegalArgumentException("插件未加载到 JVM: " + pluginId);
        }
        return wrapper.getPluginPath();
    }

    // ==================== 锁管理 ====================

    private static <T> T withReadLock(ReentrantReadWriteLock lock, java.util.function.Supplier<T> action) {
        lock.readLock().lock();
        try {
            return action.get();
        } finally {
            lock.readLock().unlock();
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
