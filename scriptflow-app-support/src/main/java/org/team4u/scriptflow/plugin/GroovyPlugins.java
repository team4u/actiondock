package org.team4u.scriptflow.plugin;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;

import java.util.LinkedHashMap;
import java.util.Map;

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
