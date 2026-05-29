package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.SystemPluginState;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * 插件查询与配置服务，负责插件信息查询、注册信息获取和配置管理。
 * <p>
 * 作为 {@link PluginRuntimeService} 的内部协作类，处理所有只读查询和配置读写操作。
 * 查询操作为读操作（共享锁），配置写入为写操作（互斥锁），由门面层管理锁。
 * <p>
 * <b>职责分区：</b>
 * <ul>
 *   <li>查询操作 — list/get/findPluginRegistration/getRegistration/readPluginFile</li>
 *   <li>配置操作 — getConfig/listConfigs/saveConfig/deleteConfig</li>
 * </ul>
 *
 * @author jay.wu
 */
class PluginQueryService {

    private final DefaultPluginManager pluginManager;
    private final PluginRegistryRepository pluginRegistryRepository;
    private final SystemPluginStateRepository systemPluginStateRepository;
    private final Map<String, ActionDockPlugin> systemPlugins;
    private final PluginConfigManager configManager;
    private final PluginFileManager fileManager;

    PluginQueryService(DefaultPluginManager pluginManager,
                       PluginRegistryRepository pluginRegistryRepository,
                       SystemPluginStateRepository systemPluginStateRepository,
                       Map<String, ActionDockPlugin> systemPlugins,
                       PluginConfigManager configManager,
                       PluginFileManager fileManager) {
        this.pluginManager = pluginManager;
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.systemPluginStateRepository = systemPluginStateRepository;
        this.systemPlugins = systemPlugins;
        this.configManager = configManager;
        this.fileManager = fileManager;
    }

    // ==================== 查询操作 ====================

    /**
     * 列出所有插件（PF4J 插件和系统插件）的摘要视图。
     *
     * @return 按插件 ID 排序的插件摘要列表
     */
    List<PluginSummaryView> list() {
        List<PluginSummaryView> plugins = new ArrayList<>();
        pluginRegistryRepository.findAll().stream()
                .map(reg -> PluginViewMapper.toPluginSummaryView(reg, pluginManager))
                .forEach(plugins::add);
        systemPlugins.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> PluginViewMapper.toSystemPluginSummaryView(entry.getKey(), entry.getValue(), isSystemPluginEnabled(entry.getKey())))
                .filter(Objects::nonNull)
                .forEach(plugins::add);
        return plugins.stream()
                .sorted(Comparator.comparing(PluginSummaryView::getPluginId))
                .toList();
    }

    /**
     * 列出所有已安装且已启动的插件引用。
     *
     * @return 按插件 ID 排序的插件引用列表
     */
    List<PluginReferenceView> listPluginReferences() {
        List<PluginReferenceView> references = new ArrayList<>();
        pluginRegistryRepository.findAll().stream()
                .filter(registration -> PluginSupport.isLoadedAndStarted(pluginManager, registration.getPluginId()))
                .sorted(Comparator.comparing(PluginRegistration::getPluginId))
                .map(PluginViewMapper::toInstalledPluginReferenceView)
                .forEach(references::add);
        systemPlugins.entrySet().stream()
                .filter(entry -> isSystemPluginEnabled(entry.getKey()))
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> PluginViewMapper.toSystemPluginReferenceView(entry.getKey(), entry.getValue()))
                .filter(Objects::nonNull)
                .forEach(references::add);
        return references.stream()
                .sorted(Comparator.comparing(PluginReferenceView::getPluginId))
                .toList();
    }

    /**
     * 获取插件详情视图。
     *
     * @param pluginId 插件 ID
     * @return 插件详情视图
     */
    PluginView get(String pluginId) {
        PluginView systemView = findSystemPluginView(pluginId);
        return systemView != null ? systemView : PluginViewMapper.toPluginView(
                PluginSupport.requireRegistration(pluginRegistryRepository, pluginId), pluginManager);
    }

    /**
     * 查找插件注册信息。
     *
     * @param pluginId 插件 ID
     * @return 注册信息（可能为空）
     */
    Optional<PluginRegistration> findPluginRegistration(String pluginId) {
        return pluginRegistryRepository.findByPluginId(pluginId)
                .map(PluginRegistration::copy);
    }

    /**
     * 获取插件注册信息，包含系统插件。
     *
     * @param pluginId 插件 ID
     * @return 插件注册信息
     */
    PluginRegistration getRegistration(String pluginId) {
        ActionDockPlugin systemPlugin = systemPlugins.get(pluginId);
        if (systemPlugin != null) {
            return PluginViewMapper.toSystemRegistration(pluginId, systemPlugin, isSystemPluginEnabled(pluginId));
        }
        return PluginSupport.requireRegistration(pluginRegistryRepository, pluginId).copy();
    }

    /**
     * 读取插件 JAR 文件内容。
     *
     * @param pluginId 插件 ID
     * @return 插件文件字节数组
     */
    byte[] readPluginFile(String pluginId) {
        if (systemPlugins.containsKey(pluginId)) {
            throw PluginSupport.systemPluginUnsupported("下载", pluginId);
        }
        try {
            PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
            return Files.readAllBytes(fileManager.resolvePluginPath(registration));
        } catch (IOException exception) {
            throw new PluginRuntimeException("读取插件文件失败: " + pluginId, exception);
        }
    }

    // ==================== 配置查询操作 ====================

    /**
     * 获取插件的默认配置视图。
     *
     * @param pluginId 插件 ID
     * @return 插件配置视图
     */
    PluginConfigView getConfig(String pluginId) {
        return getConfig(pluginId, PluginConfigManager.DEFAULT_CONFIG_NAME);
    }

    /**
     * 获取插件的指定配置视图。
     *
     * @param pluginId   插件 ID
     * @param configName 配置名
     * @return 插件配置视图
     */
    PluginConfigView getConfig(String pluginId, String configName) {
        if (systemPlugins.containsKey(pluginId)) {
            PluginSupport.assertDefaultConfigName(configName, pluginId);
            PluginRegistration registration = PluginSupport.toSystemRegistrationOrEmpty(pluginId, systemPlugins.get(pluginId));
            return buildConfigView(pluginId, registration, PluginConfigManager.DEFAULT_CONFIG_NAME);
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        String normalizedConfigName = PluginConfigManager.normalizeConfigName(configName);
        requireConfigExists(pluginId, normalizedConfigName);
        return buildConfigView(pluginId, registration, normalizedConfigName);
    }

    /**
     * 列出插件的所有配置视图。
     *
     * @param pluginId 插件 ID
     * @return 配置视图列表
     */
    List<PluginConfigView> listConfigs(String pluginId) {
        if (systemPlugins.containsKey(pluginId)) {
            PluginRegistration registration = PluginSupport.toSystemRegistrationOrEmpty(pluginId, systemPlugins.get(pluginId));
            return List.of(buildConfigView(pluginId, registration, PluginConfigManager.DEFAULT_CONFIG_NAME));
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        return configManager.listConfigNames(pluginId).stream()
                .map(configName -> buildConfigView(pluginId, registration, configName))
                .toList();
    }

    /**
     * 列出插件的所有原始有效配置。
     *
     * @param pluginId 插件 ID
     * @return 配置名到原始配置值的映射
     */
    Map<String, Map<String, Object>> listRawEffectiveConfigs(String pluginId) {
        if (systemPlugins.containsKey(pluginId)) {
            PluginRegistration registration = PluginSupport.toSystemRegistrationOrEmpty(pluginId, systemPlugins.get(pluginId));
            return Map.of(
                    PluginConfigManager.DEFAULT_CONFIG_NAME,
                    configManager.loadRawEffectiveConfig(registration.getDefaultConfig(), pluginId)
            );
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        Map<String, Map<String, Object>> configs = new LinkedHashMap<>();
        for (String configName : configManager.listConfigNames(pluginId)) {
            configs.put(configName, configManager.loadRawEffectiveConfig(registration.getDefaultConfig(), pluginId, configName));
        }
        return configs;
    }

    // ==================== 配置写入操作 ====================

    /**
     * 保存插件默认配置。
     *
     * @param pluginId 插件 ID
     * @param config   配置值
     * @return 更新后的配置视图
     */
    PluginConfigView saveConfig(String pluginId, Map<String, Object> config) {
        return saveConfig(pluginId, PluginConfigManager.DEFAULT_CONFIG_NAME, config);
    }

    /**
     * 保存插件指定配置。
     *
     * @param pluginId   插件 ID
     * @param configName 配置名
     * @param config     配置值
     * @return 更新后的配置视图
     */
    PluginConfigView saveConfig(String pluginId, String configName, Map<String, Object> config) {
        if (systemPlugins.containsKey(pluginId)) {
            String normalizedConfigName = PluginConfigManager.normalizeConfigName(configName);
            PluginSupport.assertDefaultConfigName(normalizedConfigName, pluginId);
            PluginRegistration registration = PluginSupport.toSystemRegistrationOrEmpty(pluginId, systemPlugins.get(pluginId));
            Map<String, Object> normalized = PluginConfigManager.normalizeConfig(config);
            Map<String, Object> effectiveConfig = configManager.resolveRuntimeConfig(registration.getDefaultConfig(), normalized);
            systemPlugins.get(pluginId).validateConfig(effectiveConfig);
            configManager.writeConfig(pluginId, normalizedConfigName, normalized);
            return buildConfigView(pluginId, registration, normalizedConfigName);
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        String normalizedConfigName = PluginConfigManager.normalizeConfigName(configName);
        Map<String, Object> normalized = PluginConfigManager.normalizeConfig(config);
        Map<String, Object> effectiveConfig = configManager.resolveRuntimeConfig(registration.getDefaultConfig(), normalized);
        ActionDockPlugin plugin = PluginSupport.findLoadedExtension(pluginManager, pluginId);
        if (plugin != null) {
            plugin.validateConfig(effectiveConfig);
        }
        configManager.writeConfig(pluginId, normalizedConfigName, normalized);
        return buildConfigView(pluginId, registration, normalizedConfigName);
    }

    /**
     * 删除插件的命名配置。
     *
     * @param pluginId   插件 ID
     * @param configName 配置名
     */
    void deleteConfig(String pluginId, String configName) {
        if (systemPlugins.containsKey(pluginId)) {
            throw PluginSupport.systemPluginUnsupported("配置", pluginId);
        }
        PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        String normalizedConfigName = PluginConfigManager.normalizeNamedConfigName(configName);
        requireConfigExists(pluginId, normalizedConfigName);
        configManager.deleteNamedConfig(pluginId, normalizedConfigName);
    }

    // ==================== 私有辅助方法 ====================

    private PluginConfigView buildConfigView(String pluginId, PluginRegistration registration, String configName) {
        return new PluginConfigView()
                .setPluginId(pluginId)
                .setConfigName(configName)
                .setConfigSchema(registration.getConfigSchema())
                .setDefaultConfig(registration.getDefaultConfig())
                .setConfig(configManager.loadRawEffectiveConfig(registration.getDefaultConfig(), pluginId, configName));
    }

    private void requireConfigExists(String pluginId, String configName) {
        if (!PluginConfigManager.DEFAULT_CONFIG_NAME.equals(configName) && !configManager.exists(pluginId, configName)) {
            throw PluginSupport.pluginConfigNotFound(pluginId, configName);
        }
    }

    private boolean isSystemPluginEnabled(String pluginId) {
        return systemPluginStateRepository.findByPluginId(pluginId)
                .map(SystemPluginState::isEnabled)
                .orElse(true);
    }

    private PluginView findSystemPluginView(String pluginId) {
        ActionDockPlugin plugin = systemPlugins.get(pluginId);
        if (plugin == null) {
            return null;
        }
        return PluginViewMapper.toSystemPluginView(pluginId, plugin, isSystemPluginEnabled(pluginId));
    }
}
