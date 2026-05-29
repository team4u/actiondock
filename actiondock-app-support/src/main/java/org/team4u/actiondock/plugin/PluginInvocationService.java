package org.team4u.actiondock.plugin;

import org.pf4j.DefaultPluginManager;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionOutputProjector;
import org.team4u.actiondock.application.MapValueConverter;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.model.SystemPluginState;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件动作调用服务，负责执行插件动作和调试调用。
 * <p>
 * 作为 {@link PluginRuntimeService} 的内部协作类，处理所有插件动作的调用逻辑。
 * 调用操作为读操作，由门面层持有读锁保证并发安全。
 * <p>
 * <b>关键设计：</b>
 * <ul>
 *   <li>区分系统插件和 PF4J 插件的调用路径</li>
 *   <li>构建 {@link ScriptPluginContext} 后委托给插件实现</li>
 *   <li>调试模式支持配置值解析和输出投影</li>
 * </ul>
 *
 * @author jay.wu
 */
class PluginInvocationService {

    private final DefaultPluginManager pluginManager;
    private final PluginRegistryRepository pluginRegistryRepository;
    private final SystemPluginStateRepository systemPluginStateRepository;
    private final Map<String, ActionDockPlugin> systemPlugins;
    private final PluginConfigManager configManager;
    private final ConfigValueApplicationService configValueApplicationService;
    private final boolean enabled;

    PluginInvocationService(DefaultPluginManager pluginManager,
                            PluginRegistryRepository pluginRegistryRepository,
                            SystemPluginStateRepository systemPluginStateRepository,
                            Map<String, ActionDockPlugin> systemPlugins,
                            PluginConfigManager configManager,
                            ConfigValueApplicationService configValueApplicationService,
                            boolean enabled) {
        this.pluginManager = pluginManager;
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.systemPluginStateRepository = systemPluginStateRepository;
        this.systemPlugins = systemPlugins;
        this.configManager = configManager;
        this.configValueApplicationService = configValueApplicationService;
        this.enabled = enabled;
    }

    // ==================== 动作调用 ====================

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
    Object invoke(String pluginId,
                  String action,
                  ScriptDefinition definition,
                  ScriptExecutionContext executionContext,
                  Map<String, Object> input,
                  Map<String, Object> args) {
        return invoke(pluginId, action, definition, executionContext, input, args,
                PluginConfigManager.DEFAULT_CONFIG_NAME);
    }

    /**
     * 调用插件动作（指定配置名）。
     *
     * @param pluginId         插件 ID
     * @param action           动作名称
     * @param definition       当前执行的脚本定义，可为 null
     * @param executionContext 执行上下文，可为 null
     * @param input            脚本输入参数
     * @param args             动作调用参数
     * @param configName       配置名
     * @return 动作执行结果
     */
    Object invoke(String pluginId,
                  String action,
                  ScriptDefinition definition,
                  ScriptExecutionContext executionContext,
                  Map<String, Object> input,
                  Map<String, Object> args,
                  String configName) {
        assertActionAvailable(pluginId, action);
        return doInvoke(pluginId, action, definition, executionContext, input, args, configName);
    }

    /**
     * 调试模式调用插件动作，返回包含调试信息的视图。
     * <p>
     * 支持配置值解析和输出投影，可选择是否包含调试详情（脱敏后的参数和脚本输入）。
     *
     * @param pluginId     插件 ID
     * @param action       动作名称
     * @param args         动作调用参数
     * @param scriptInput  模拟的脚本输入
     * @param includeDebug 是否包含调试信息
     * @return 插件调用结果视图
     */
    PluginInvokeView invokeForDebug(String pluginId,
                                    String action,
                                    Map<String, Object> args,
                                    Map<String, Object> scriptInput,
                                    boolean includeDebug) {
        return invokeForDebug(pluginId, action, args, scriptInput, includeDebug,
                PluginConfigManager.DEFAULT_CONFIG_NAME);
    }

    /**
     * 调试模式调用插件动作（指定配置名）。
     *
     * @param pluginId     插件 ID
     * @param action       动作名称
     * @param args         动作调用参数
     * @param scriptInput  模拟的脚本输入
     * @param includeDebug 是否包含调试信息
     * @param configName   配置名
     * @return 插件调用结果视图
     */
    PluginInvokeView invokeForDebug(String pluginId,
                                    String action,
                                    Map<String, Object> args,
                                    Map<String, Object> scriptInput,
                                    boolean includeDebug,
                                    String configName) {
        PluginRegistration registration = systemPlugins.containsKey(pluginId)
                ? PluginViewMapper.toSystemRegistration(pluginId, systemPlugins.get(pluginId), true)
                : PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        PluginActionMetadata actionMetadata = PluginSupport.requireActionMetadata(registration, action);
        assertActionAvailable(pluginId, action);
        String normalizedConfigName = PluginConfigManager.normalizeConfigName(configName);
        ConfigValueApplicationService.ResolvedMapView argsView = configValueApplicationService.resolveMapView(args);
        ConfigValueApplicationService.ResolvedMapView scriptInputView = configValueApplicationService.resolveMapView(scriptInput);
        Map<String, Object> normalizedArgs = argsView.resolved();
        Map<String, Object> normalizedScriptInput = scriptInputView.resolved();
        Map<String, Object> pluginResult = MapValueConverter.toResultMap(
                doInvoke(pluginId, action, null,
                        new ScriptExecutionContext()
                                .setSubmitMode(SubmitMode.SYNC)
                                .setConfig(configValueApplicationService.snapshot()),
                        normalizedScriptInput, normalizedArgs, normalizedConfigName)
        );
        return new PluginInvokeView()
                .setPluginId(pluginId)
                .setAction(action)
                .setResult(ExecutionOutputProjector.project(pluginResult, actionMetadata.getOutputSchema()))
                .setDebug(includeDebug
                        ? new PluginInvokeDebugView()
                        .setArgs(argsView.redacted())
                        .setScriptInput(scriptInputView.redacted())
                        : null);
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 执行插件动作的实际调用逻辑。
     * <p>
     * 区分系统插件和 PF4J 插件的调用路径，构建 {@link ScriptPluginContext} 后委托给插件实现。
     */
    private Object doInvoke(String pluginId,
                            String action,
                            ScriptDefinition definition,
                            ScriptExecutionContext executionContext,
                            Map<String, Object> input,
                            Map<String, Object> args,
                            String configName) {
        try {
            ActionDockPlugin systemPlugin = systemPlugins.get(pluginId);
            ActionDockPlugin plugin;
            Map<String, Object> pluginConfig;
            String normalizedConfigName = PluginConfigManager.normalizeConfigName(configName);

            if (systemPlugin != null) {
                PluginSupport.assertDefaultConfigName(normalizedConfigName, pluginId);
                if (!isSystemPluginEnabled(pluginId)) {
                    throw PluginSupport.pluginNotStarted(pluginId);
                }
                plugin = systemPlugin;
                PluginRegistration registration = PluginSupport.toSystemRegistrationOrEmpty(pluginId, systemPlugin);
                pluginConfig = configManager.loadRuntimeConfig(registration.getDefaultConfig(), pluginId, normalizedConfigName);
            } else {
                PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
                plugin = PluginSupport.requireLoadedExtension(pluginManager, pluginId);
                requireConfigExists(pluginId, normalizedConfigName);
                pluginConfig = configManager.loadRuntimeConfig(registration.getDefaultConfig(), pluginId, normalizedConfigName);
            }

            ScriptPluginContext context = new ScriptPluginContext()
                    .setScriptId(definition == null ? null : definition.getId())
                    .setScriptName(definition == null ? null : definition.getName())
                    .setExecutionId(executionContext == null ? null : executionContext.getExecutionId())
                    .setSubmitMode(resolveSubmitMode(executionContext))
                    .setScriptInput(input)
                    .setPluginConfigName(normalizedConfigName)
                    .setPluginConfig(pluginConfig);

            return plugin.invoke(action, context, args == null ? Map.of() : new LinkedHashMap<>(args));
        } catch (ActionDockException exception) {
            throw exception;
        } catch (Exception exception) {
            throw PluginSupport.enrichPluginInvocationException(pluginId, action, exception);
        }
    }

    /**
     * 校验插件动作是否可用（插件已启用且动作已注册）。
     */
    private void assertActionAvailable(String pluginId, String action) {
        if (systemPlugins.containsKey(pluginId)) {
            if (!isSystemPluginEnabled(pluginId)) {
                throw PluginSupport.pluginNotStarted(pluginId);
            }
            PluginRegistration registration;
            try {
                registration = PluginViewMapper.toSystemRegistration(pluginId, systemPlugins.get(pluginId), true);
            } catch (IllegalArgumentException exception) {
                return;
            }
            PluginSupport.requireActionMetadata(registration, action);
            return;
        }
        PluginRegistration registration = PluginSupport.requireRegistration(pluginRegistryRepository, pluginId);
        if (!registration.isEnabled() || !PluginSupport.isLoadedAndStarted(pluginManager, pluginId)) {
            throw PluginSupport.pluginNotStarted(pluginId);
        }
        boolean exists = registration.getActions().stream()
                .map(org.team4u.actiondock.domain.model.PluginActionMetadata::getAction)
                .anyMatch(action::equals);
        if (!exists) {
            throw PluginSupport.pluginActionNotFound(pluginId, action);
        }
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

    private static String resolveSubmitMode(ScriptExecutionContext executionContext) {
        SubmitMode submitMode = executionContext == null ? null : executionContext.getSubmitMode();
        return submitMode == null ? null : submitMode.name();
    }
}
