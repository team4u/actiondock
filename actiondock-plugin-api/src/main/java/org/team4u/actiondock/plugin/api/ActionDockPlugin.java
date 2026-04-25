package org.team4u.actiondock.plugin.api;

import org.pf4j.ExtensionPoint;

import java.util.Map;

public interface ActionDockPlugin extends ExtensionPoint {

    /**
     * 获取插件的唯一标识。
     *
     * @return 插件 ID，全局唯一
     */
    String id();

    /**
     * 校验合并平台默认值后的最终插件配置。
     * <p>
     * 平台会在调用 {@link #invoke} 之前调用此方法，插件可在此检查配置项的合法性。
     *
     * @param config 最终生效的插件配置，已包含平台默认值
     */
    default void validateConfig(Map<String, Object> config) {
    }

    /**
     * 调用插件的指定动作。
     * <p>
     * 根据动作名称路由到插件内部的具体逻辑，并传入执行上下文和调用参数。
     *
     * @param action  动作名称，对应 {@link PluginActionManifest#getAction()}
     * @param context 脚本执行上下文，提供脚本信息和插件配置
     * @param args    调用参数，由脚本步骤传入
     * @return 插件动作的执行结果
     * @throws PluginRuntimeException 如果插件执行过程中发生错误
     */
    Object invoke(String action, ScriptPluginContext context, Map<String, Object> args);
}
