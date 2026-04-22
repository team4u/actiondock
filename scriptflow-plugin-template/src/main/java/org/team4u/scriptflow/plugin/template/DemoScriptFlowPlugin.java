package org.team4u.scriptflow.plugin.template;

import org.pf4j.Extension;
import org.team4u.scriptflow.plugin.api.PluginActionManifest;
import org.team4u.scriptflow.plugin.api.PluginManifest;
import org.team4u.scriptflow.plugin.api.ScriptFlowPlugin;
import org.team4u.scriptflow.plugin.api.ScriptPluginContext;

import java.util.List;
import java.util.Map;

@Extension
public class DemoScriptFlowPlugin implements ScriptFlowPlugin {
    @Override
    public PluginManifest descriptor() {
        return new PluginManifest()
                .setPluginId("scriptflow-demo-plugin")
                .setName("ScriptFlow Demo Plugin")
                .setDescription("Template plugin exposing sample actions to Groovy scripts.")
                .setVersion("0.2.0")
                .setConfigSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "prefix", Map.of(
                                        "type", "string",
                                        "title", "Prefix"
                                )
                        )
                ))
                .setDefaultConfig(Map.of("prefix", "demo"))
                .setActions(List.of(
                        new PluginActionManifest()
                                .setAction("echo")
                                .setTitle("Echo message")
                                .setDescription("Return a message prefixed by plugin configuration.")
                                .setInputSchema(Map.of(
                                        "type", "object",
                                        "properties", Map.of(
                                                "message", Map.of("type", "string", "title", "Message")
                                        )
                                ))
                                .setExampleArgs(Map.of("message", "hello"))
                ));
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
