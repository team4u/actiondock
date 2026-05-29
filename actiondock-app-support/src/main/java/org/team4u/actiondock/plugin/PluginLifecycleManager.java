package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginState;
import org.pf4j.PluginWrapper;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.SystemPluginState;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.common.NormalizeUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 插件生命周期管理器，负责插件的安装、升级、卸载、启停和初始化。
 * <p>
 * 作为 {@link PluginRuntimeService} 的内部协作类，处理所有涉及 PF4J 插件状态变更的操作。
 * 生命周期操作均为写操作，由门面层持有写锁保证互斥。
 * <p>
 * <b>关键设计：</b>
 * <ul>
 *   <li>安装时先写入 staging 临时文件，校验通过后原子性移动到目标路径</li>
 *   <li>升级支持回滚——失败时恢复旧版本插件文件和注册信息</li>
 *   <li>卸载前检查脚本依赖（除非 force=true）</li>
 * </ul>
 *
 * @author jay.wu
 */
class PluginLifecycleManager {

    private static final Logger LOGGER = LoggerFactory.getLogger(PluginLifecycleManager.class);

    private final DefaultPluginManager pluginManager;
    private final PluginFileManager fileManager;
    private final PluginRegistryRepository pluginRegistryRepository;
    private final SystemPluginStateRepository systemPluginStateRepository;
    private final ScriptRepository scriptRepository;
    private final Map<String, ?> systemPlugins;
    private final Map<String, PluginManifest> manifestCache;
    private final PluginConfigManager configManager;
    private final Path pluginsRoot;
    private final boolean enabled;

    PluginLifecycleManager(DefaultPluginManager pluginManager,
                           PluginFileManager fileManager,
                           PluginRegistryRepository pluginRegistryRepository,
                           SystemPluginStateRepository systemPluginStateRepository,
                           ScriptRepository scriptRepository,
                           Map<String, ?> systemPlugins,
                           Map<String, PluginManifest> manifestCache,
                           PluginConfigManager configManager,
                           Path pluginsRoot,
                           boolean enabled) {
        this.pluginManager = pluginManager;
        this.fileManager = fileManager;
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.systemPluginStateRepository = systemPluginStateRepository;
        this.scriptRepository = scriptRepository;
        this.systemPlugins = systemPlugins;
        this.manifestCache = manifestCache;
        this.configManager = configManager;
        this.pluginsRoot = pluginsRoot;
        this.enabled = enabled;
    }

    // ==================== 安装 ====================

    /**
     * 安装插件。
     *
     * @param originalFilename 原始文件名
     * @param content          插件文件内容
     * @return 安装后的插件视图
     */
    PluginView install(String originalFilename, byte[] content) {
        return install(originalFilename, content, null, null, null);
    }

    /**
     * 从仓库安装插件。
     *
     * @param originalFilename    原始文件名
     * @param content             插件文件内容
     * @param repositoryId        仓库 ID
     * @param repositoryPluginId  仓库插件 ID
     * @param repositoryVersion   仓库版本号
     * @return 安装后的插件视图
     */
    PluginView installFromRepository(String originalFilename,
                                      byte[] content,
                                      String repositoryId,
                                      String repositoryPluginId,
                                      String repositoryVersion) {
        return install(originalFilename, content, repositoryId, repositoryPluginId, repositoryVersion);
    }

    private PluginView install(String originalFilename,
                               byte[] content,
                               String repositoryId,
                               String repositoryPluginId,
                               String repositoryVersion) {
        PluginSupport.ensureEnabled(enabled);
        String fileName = fileManager.sanitizeFilename(originalFilename);
        Path destination = fileManager.uniquePluginPath(fileName);
        String pluginId = null;
        try {
            pluginId = persistPluginArtifact(content, destination, repositoryVersion);
            if (systemPlugins.containsKey(pluginId)) {
                throw ActionDockException.conflict(
                        ActionDockErrorCodes.PLUGIN_EXISTS,
                        "插件 ID 与系统插件冲突: " + pluginId,
                        Map.of("pluginId", pluginId)
                );
            }
            if (pluginRegistryRepository.findByPluginId(pluginId).isPresent()) {
                throw ActionDockException.conflict(
                        ActionDockErrorCodes.PLUGIN_EXISTS,
                        "插件已存在: " + pluginId,
                        Map.of("pluginId", pluginId)
                );
            }
            PluginRegistration saved = saveRegistration(pluginId, destination.getFileName().toString(),
                    true, null, repositoryId, repositoryPluginId, repositoryVersion);
            return PluginViewMapper.toPluginView(saved, pluginManager);
        } catch (Exception exception) {
            cleanupFailedInstall(pluginId, destination);
            if (exception instanceof PluginRuntimeException pluginRuntimeException) {
                throw pluginRuntimeException;
            }
            if (exception instanceof ActionDockException actionDockException) {
                throw actionDockException;
            }
            throw new PluginRuntimeException("安装插件失败: " + exception.getMessage(), exception);
        }
    }

    // ==================== 升级 ====================

    /**
     * 升级插件。
     *
     * @param pluginId         插件 ID
     * @param originalFilename 原始文件名
     * @param content          插件文件内容
     * @return 升级后的插件视图
     */
    PluginView upgrade(String pluginId, String originalFilename, byte[] content) {
        return upgrade(pluginId, originalFilename, content, null, null, null);
    }

    /**
     * 从仓库升级插件。
     *
     * @param pluginId            插件 ID
     * @param originalFilename    原始文件名
     * @param content             插件文件内容
     * @param repositoryId        仓库 ID
     * @param repositoryPluginId  仓库插件 ID
     * @param repositoryVersion   仓库版本号
     * @return 升级后的插件视图
     */
    PluginView upgradeFromRepository(String pluginId,
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
        PluginSupport.ensureEnabled(enabled);
        if (systemPlugins.containsKey(pluginId)) {
            throw PluginSupport.systemPluginUnsupported("升级", pluginId);
        }
        PluginRegistration current = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        PluginRegistration backup = current.copy();
        Path oldPluginPath = fileManager.resolvePluginPath(current);
        boolean wasEnabled = current.isEnabled();
        return performUpgrade(pluginId, originalFilename, content, repositoryId, repositoryPluginId,
                repositoryVersion, backup, oldPluginPath, wasEnabled);
    }

    // ==================== 启停 ====================

    /**
     * 启动插件。
     *
     * @param pluginId 插件 ID
     * @return 启动后的插件视图
     */
    PluginView start(String pluginId) {
        PluginSupport.ensureEnabled(enabled);
        if (systemPlugins.containsKey(pluginId)) {
            saveSystemPluginState(pluginId, true);
            return requireSystemPluginView(pluginId);
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        loadRegisteredPlugin(registration);
        PluginRegistration saved = saveRegistration(pluginId, registration.getFileName(), true, registration);
        return PluginViewMapper.toPluginView(saved, pluginManager);
    }

    /**
     * 停止插件。
     *
     * @param pluginId 插件 ID
     * @return 停止后的插件视图
     */
    PluginView stop(String pluginId) {
        PluginSupport.ensureEnabled(enabled);
        if (systemPlugins.containsKey(pluginId)) {
            saveSystemPluginState(pluginId, false);
            return requireSystemPluginView(pluginId);
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        unloadIfLoaded(pluginId);
        PluginRegistration saved = pluginRegistryRepository.save(
                registration.copy()
                        .setEnabled(false)
                        .setUpdatedAt(LocalDateTime.now())
        );
        return PluginViewMapper.toPluginView(saved, pluginManager);
    }

    // ==================== 卸载 ====================

    /**
     * 卸载插件。
     * <p>
     * 默认检查脚本依赖，force=true 时跳过依赖检查。
     *
     * @param pluginId 插件 ID
     * @param force    是否强制卸载
     */
    void uninstall(String pluginId, boolean force) {
        PluginSupport.ensureEnabled(enabled);
        if (systemPlugins.containsKey(pluginId)) {
            throw PluginSupport.systemPluginUnsupported("卸载", pluginId);
        }
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
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        unloadIfLoaded(pluginId);
        fileManager.deletePluginFile(registration);
        pluginRegistryRepository.deleteByPluginId(pluginId);
        manifestCache.remove(pluginId);
        configManager.deleteConfig(pluginId);
    }

    // ==================== 初始化 ====================

    /**
     * 初始化插件运行时环境。
     * <p>
     * 创建插件目录、清理遗留的 staging 文件，并加载所有已注册且启用的插件。
     * 加载失败的插件仅记录警告，不阻塞其他插件的加载。
     */
    void initialize() {
        try {
            Files.createDirectories(pluginsRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot initialize plugin directories", e);
        }
        cleanupStagingFiles();
        pluginRegistryRepository.findEnabled().forEach(registration -> {
            try {
                loadRegisteredPlugin(registration);
                saveRegistration(registration.getPluginId(), registration.getFileName(), true, registration);
            } catch (Exception e) {
                LOGGER.warn("Failed to load plugin on startup: {}", registration.getPluginId(), e);
            }
        });
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 持久化插件文件并加载到运行时。
     * <p>
     * 先将内容写入临时文件，校验通过后原子性移动到目标路径，避免失败时遗留不完整文件。
     *
     * @param content           插件文件内容
     * @param destination       目标写入路径
     * @param repositoryVersion 预期的仓库版本号
     * @return 加载后的插件 ID
     */
    private String persistPluginArtifact(byte[] content, Path destination, String repositoryVersion) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("插件文件不能为空");
        }
        Path staging = pluginsRoot.resolve(".staging").resolve(destination.getFileName());
        try {
            Files.createDirectories(staging.getParent());
            Files.write(staging, content);
        } catch (IOException exception) {
            throw new IllegalStateException("写入插件文件失败: " + destination.getFileName(), exception);
        }
        String pluginId = null;
        try {
            pluginId = loadPlugin(staging);
            cacheManifest(pluginId);
            if (NormalizeUtils.isNotBlank(repositoryVersion) && !repositoryVersion.equals(manifestCache.get(pluginId).getVersion())) {
                throw new IllegalArgumentException("插件版本与仓库描述不一致: " + manifestCache.get(pluginId).getVersion());
            }
            unloadIfLoaded(pluginId);
        } catch (Exception exception) {
            if (pluginId != null) {
                unloadIfLoaded(pluginId);
                manifestCache.remove(pluginId);
            }
            deleteSilently(staging);
            throw exception;
        }
        try {
            Files.move(staging, destination);
            loadPlugin(destination);
            cacheManifest(pluginId);
        } catch (IOException exception) {
            unloadIfLoaded(pluginId);
            manifestCache.remove(pluginId);
            deleteSilently(staging);
            throw new IllegalStateException("提交插件文件失败: " + destination.getFileName(), exception);
        } catch (Exception exception) {
            unloadIfLoaded(pluginId);
            manifestCache.remove(pluginId);
            deleteSilently(destination);
            throw exception;
        }
        return pluginId;
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
            saved = saveRegistration(pluginId, destination.getFileName().toString(), wasEnabled, backup,
                    repositoryId, repositoryPluginId, repositoryVersion);
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

    private PluginRegistration saveRegistration(String pluginId, String fileName,
                                                boolean enabled, PluginRegistration previous) {
        return saveRegistration(pluginId, fileName, enabled, previous,
                previous.getRepositoryId(), previous.getRepositoryPluginId(), previous.getRepositoryVersion());
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

    private void cleanupStagingFiles() {
        Path stagingDir = pluginsRoot.resolve(".staging");
        if (!Files.isDirectory(stagingDir)) {
            return;
        }
        try (var stream = Files.list(stagingDir)) {
            stream.forEach(PluginLifecycleManager::deleteSilently);
        } catch (IOException e) {
            LOGGER.warn("扫描 staging 文件失败", e);
        }
    }

    private static void deleteSilently(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException e) {
            LOGGER.warn("删除临时文件失败: {}", path, e);
        }
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
        org.team4u.actiondock.plugin.api.ActionDockPlugin extension =
                PluginSupport.requireLoadedExtension(pluginManager, pluginId);
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

    void unloadIfLoaded(String pluginId) {
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

    private boolean isSystemPluginEnabled(String pluginId) {
        return systemPluginStateRepository.findByPluginId(pluginId)
                .map(SystemPluginState::isEnabled)
                .orElse(true);
    }

    private void saveSystemPluginState(String pluginId, boolean enabled) {
        systemPluginStateRepository.save(new SystemPluginState()
                .setPluginId(pluginId)
                .setEnabled(enabled)
                .setUpdatedAt(LocalDateTime.now()));
    }

    private PluginView requireSystemPluginView(String pluginId) {
        org.team4u.actiondock.plugin.api.ActionDockPlugin plugin =
                (org.team4u.actiondock.plugin.api.ActionDockPlugin) systemPlugins.get(pluginId);
        if (plugin == null) {
            throw PluginSupport.pluginNotFound(pluginId);
        }
        return PluginViewMapper.toSystemPluginView(pluginId, plugin, isSystemPluginEnabled(pluginId));
    }
}
