package org.team4u.scriptflow.plugin.template;

import org.pf4j.Extension;
import org.team4u.scriptflow.plugin.api.PluginConfigBinder;
import org.team4u.scriptflow.plugin.api.ScriptFlowPlugin;
import org.team4u.scriptflow.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;

@Extension
public class DemoScriptFlowPlugin implements ScriptFlowPlugin {
    @Override
    public String id() {
        return "scriptflow-demo-plugin";
    }

    @Override
    public void validateConfig(Map<String, Object> config) {
        PluginConfigBinder.bind(config, DemoPluginConfig.class);
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        if ("echo".equals(action)) {
            DemoPluginConfig config = context.getPluginConfig(DemoPluginConfig.class);
            String prefix = String.valueOf(config.getPrefix());
            String message = String.valueOf(args.getOrDefault("message", ""));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("message", prefix + ":" + message);
            if (context.getScriptId() != null) {
                result.put("scriptId", context.getScriptId());
            }
            if (context.getExecutionId() != null) {
                result.put("executionId", context.getExecutionId());
            }
            return result;
        }
        throw new IllegalArgumentException("Unsupported action: " + action);
    }
}
