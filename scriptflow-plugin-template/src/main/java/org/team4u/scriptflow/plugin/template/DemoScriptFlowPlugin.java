package org.team4u.scriptflow.plugin.template;

import org.pf4j.Extension;
import org.team4u.scriptflow.plugin.api.ScriptFlowPlugin;
import org.team4u.scriptflow.plugin.api.ScriptPluginContext;

import java.util.Map;

@Extension
public class DemoScriptFlowPlugin implements ScriptFlowPlugin {
    @Override
    public String id() {
        return "scriptflow-demo-plugin";
    }

    @Override
    public void validateConfig(Map<String, Object> config) {
        Object prefix = config.get("prefix");
        if (prefix != null && !(prefix instanceof String)) {
            throw new IllegalArgumentException("Plugin config field 'prefix' must be a string");
        }
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        if ("echo".equals(action)) {
            String prefix = String.valueOf(context.getPluginConfig().getOrDefault("prefix", "demo"));
            String message = String.valueOf(args.getOrDefault("message", ""));
            return Map.of(
                    "message", prefix + ":" + message,
                    "scriptId", context.getScriptId(),
                    "executionId", context.getExecutionId()
            );
        }
        throw new IllegalArgumentException("Unsupported action: " + action);
    }
}
