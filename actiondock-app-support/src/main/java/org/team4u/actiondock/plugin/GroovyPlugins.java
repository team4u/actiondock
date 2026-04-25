package org.team4u.actiondock.plugin;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Groovy 脚本中的插件调用桥接对象。
 * <p>
 * 作为 Groovy 脚本绑定变量 {@code plugins} 提供，简化脚本中的插件调用语法。
 *
 * @author jay.wu
 */
public class GroovyPlugins {
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptDefinition definition;
    private final Map<String, Object> input;
    private final ScriptExecutionContext executionContext;

    /**
     * 创建插件调用桥接对象。
     *
     * @param pluginRuntimeService 插件运行时服务
     * @param definition           当前执行的脚本定义
     * @param input                脚本输入数据
     * @param executionContext     脚本执行上下文
     */
    public GroovyPlugins(PluginRuntimeService pluginRuntimeService,
                         ScriptDefinition definition,
                         Map<String, Object> input,
                         ScriptExecutionContext executionContext) {
        this.pluginRuntimeService = pluginRuntimeService;
        this.definition = definition;
        this.input = input == null ? Map.of() : new LinkedHashMap<>(input);
        this.executionContext = executionContext;
    }

    /**
     * 调用指定插件的动作（无参数版本）。
     *
     * @param pluginId 插件唯一标识
     * @param action   动作名称
     * @return 插件动作的返回值
     * @see PluginRuntimeService#invoke
     */
    public Object invoke(String pluginId, String action) {
        return invoke(pluginId, action, Map.of());
    }

    /**
     * 调用指定插件的动作。
     * <p>
     * 在 Groovy 脚本中可通过 {@code plugins.invoke("my-plugin", "actionName", [key: value])} 调用。
     *
     * @param pluginId 插件唯一标识
     * @param action   动作名称
     * @param args     传递给插件动作的参数
     * @return 插件动作的返回值
     * @see PluginRuntimeService#invoke
     */
    public Object invoke(String pluginId, String action, Map<String, Object> args) {
        return pluginRuntimeService.invoke(pluginId, action, definition, executionContext, input, args);
    }
}
