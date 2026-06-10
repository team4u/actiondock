package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.pf4j.PluginWrapper;
import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * 插件运行时共享工具方法。
 * <p>
 * 提供插件注册查询、扩展点解析、异常构造等公共逻辑，
 * 供 {@link PluginRuntimeService} 及其内部协作类复用。
 *
 * @author jay.wu
 */
final class PluginSupport {

    private PluginSupport() {
    }

    /**
     * 校验插件运行时是否已启用。
     *
     * @param enabled 启用状态
     * @throws IllegalStateException 若未启用
     */
    static void ensureEnabled(boolean enabled) {
        if (!enabled) {
            throw new IllegalStateException("插件运行时未启用");
        }
    }

    /**
     * 根据插件 ID 查找注册信息，不存在时抛出异常。
     *
     * @param pluginRegistryRepository 插件注册仓库
     * @param pluginId                 插件 ID
     * @return 插件注册信息
     * @throws ActionDockException 插件不存在
     */
    static PluginRegistration requireRegistration(PluginRegistryRepository pluginRegistryRepository,
                                                   String pluginId) {
        return pluginRegistryRepository.findByPluginId(pluginId)
                .orElseThrow(() -> pluginNotFound(pluginId));
    }

    /**
     * 判断插件是否已加载并启动。
     *
     * @param pluginManager PF4J 插件管理器
     * @param pluginId      插件 ID
     * @return 是否已加载且启动
     */
    static boolean isLoadedAndStarted(DefaultPluginManager pluginManager, String pluginId) {
        PluginWrapper wrapper = pluginManager.getPlugin(pluginId);
        return wrapper != null && wrapper.getPluginState().isStarted();
    }

    /**
     * 查找已加载的插件扩展点实例。
     *
     * @param pluginManager PF4J 插件管理器
     * @param pluginId      插件 ID
     * @return 扩展点实例，不存在返回 null
     */
    static ActionDockPlugin findLoadedExtension(DefaultPluginManager pluginManager, String pluginId) {
        return pluginManager.getExtensions(ActionDockPlugin.class, pluginId).stream()
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    /**
     * 查找已加载的插件扩展点实例，不存在时抛出异常。
     *
     * @param pluginManager PF4J 插件管理器
     * @param pluginId      插件 ID
     * @return 扩展点实例
     * @throws IllegalArgumentException 插件未加载
     */
    static ActionDockPlugin requireLoadedExtension(DefaultPluginManager pluginManager, String pluginId) {
        ActionDockPlugin extension = findLoadedExtension(pluginManager, pluginId);
        if (extension == null) {
            throw new IllegalArgumentException("插件未加载到 JVM: " + pluginId);
        }
        return extension;
    }

    /**
     * 将系统插件转换为注册信息，转换失败时返回空壳注册。
     *
     * @param pluginId 插件 ID
     * @param plugin   系统插件实例
     * @return 插件注册信息
     */
    static PluginRegistration toSystemRegistrationOrEmpty(String pluginId, ActionDockPlugin plugin) {
        try {
            return PluginViewMapper.toSystemRegistration(pluginId, plugin, true);
        } catch (IllegalArgumentException exception) {
            return new PluginRegistration()
                    .setPluginId(pluginId)
                    .setConfigSchema(Map.of())
                    .setDefaultConfig(Map.of())
                    .setEnabled(true);
        }
    }

    /**
     * 查找插件注册的动作元数据，不存在时抛出异常。
     *
     * @param registration 插件注册信息
     * @param action       动作名称
     * @return 动作元数据
     * @throws ActionDockException 动作不存在
     */
    static PluginActionMetadata requireActionMetadata(PluginRegistration registration, String action) {
        return registration.getActions().stream()
                .filter(metadata -> action.equals(metadata.getAction()))
                .findFirst()
                .orElseThrow(() -> pluginActionNotFound(registration.getPluginId(), action));
    }

    /**
     * 校验系统插件只使用默认配置名。
     *
     * @param configName 配置名
     * @param pluginId   插件 ID
     * @throws ActionDockException 系统插件不支持命名配置
     */
    static void assertDefaultConfigName(String configName, String pluginId) {
        String normalizedConfigName = PluginConfigManager.normalizeConfigName(configName);
        if (!PluginConfigManager.DEFAULT_CONFIG_NAME.equals(normalizedConfigName)) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLUGIN_SYSTEM_OPERATION_UNSUPPORTED,
                    "系统插件不支持命名配置: " + pluginId + "/" + normalizedConfigName,
                    Map.of("pluginId", pluginId, "configName", normalizedConfigName)
            );
        }
    }

    /**
     * 丰富插件调用异常信息，添加插件 ID 和动作名称上下文。
     *
     * @param pluginId  插件 ID
     * @param action    动作名称
     * @param exception 原始异常
     * @return 丰富后的异常
     */
    static PluginRuntimeException enrichPluginInvocationException(String pluginId, String action, Exception exception) {
        String prefix = "插件调用失败 " + pluginId + "/" + action + ": ";
        String message = ErrorDetailSupport.summarize(exception);
        if (message.startsWith(prefix) && exception instanceof PluginRuntimeException pluginRuntimeException) {
            return pluginRuntimeException;
        }
        if (exception instanceof PluginRuntimeException pluginRuntimeException) {
            Map<String, Object> details = new LinkedHashMap<>(pluginRuntimeException.getDetails());
            details.putIfAbsent("pluginId", pluginId);
            details.putIfAbsent("action", action);
            return new PluginRuntimeException(
                    pluginRuntimeException.getStatus(),
                    pluginRuntimeException.getCode(),
                    message.startsWith(prefix) ? message : prefix + message,
                    details,
                    pluginRuntimeException
            );
        }
        return new PluginRuntimeException(
                message.startsWith(prefix) ? message : prefix + message,
                exception
        );
    }

    // ==================== 异常工厂方法 ====================

    static ActionDockException pluginNotFound(String pluginId) {
        return ActionDockException.notFound(
                ActionDockErrorCodes.PLUGIN_NOT_FOUND,
                "插件不存在: " + pluginId,
                Map.of("pluginId", pluginId)
        );
    }

    static ActionDockException pluginActionNotFound(String pluginId, String action) {
        return ActionDockException.notFound(
                ActionDockErrorCodes.PLUGIN_ACTION_NOT_FOUND,
                "插件动作不存在: " + pluginId + "/" + action,
                Map.of("pluginId", pluginId, "action", action)
        );
    }

    static ActionDockException pluginConfigNotFound(String pluginId, String configName) {
        return ActionDockException.notFound(
                ActionDockErrorCodes.PLUGIN_CONFIG_NOT_FOUND,
                "插件配置不存在: " + pluginId + "/" + configName,
                Map.of("pluginId", pluginId, "configName", configName)
        );
    }

    static ActionDockException pluginNotStarted(String pluginId) {
        return ActionDockException.conflict(
                ActionDockErrorCodes.PLUGIN_NOT_STARTED,
                "插件未启动: " + pluginId,
                Map.of("pluginId", pluginId)
        );
    }

    static ActionDockException systemPluginUnsupported(String operation, String pluginId) {
        return ActionDockException.conflict(
                ActionDockErrorCodes.PLUGIN_SYSTEM_OPERATION_UNSUPPORTED,
                "系统插件不支持" + operation + ": " + pluginId,
                Map.of("pluginId", pluginId, "operation", operation)
        );
    }
}
