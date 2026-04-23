package org.team4u.scriptflow.plugin;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;

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

    public GroovyPlugins(PluginRuntimeService pluginRuntimeService,
                         ScriptDefinition definition,
                         Map<String, Object> input,
                         ScriptExecutionContext executionContext) {
        this.pluginRuntimeService = pluginRuntimeService;
        this.definition = definition;
        this.input = input == null ? Map.of() : new LinkedHashMap<>(input);
        this.executionContext = executionContext;
    }

    public Object invoke(String pluginId, String action) {
        return invoke(pluginId, action, Map.of());
    }

    public Object invoke(String pluginId, String action, Map<String, Object> args) {
        return pluginRuntimeService.invoke(pluginId, action, definition, executionContext, input, args);
    }
}
