package org.team4u.scriptflow.cli;

import org.springframework.stereotype.Component;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.plugin.PluginInvokeView;
import org.team4u.scriptflow.plugin.PluginRuntimeService;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.util.Locale;
import java.util.Map;

@Component
@Command(name = "plugin", subcommands = {PluginCommands.InvokePlugin.class})
public class PluginCommands implements Runnable {
    @Override
    public void run() {
        System.out.println("Use plugin invoke");
    }

    @Component
    @Command(name = "invoke")
    static class InvokePlugin implements Runnable {
        private final PluginRuntimeService pluginRuntimeService;
        private final JsonCodec jsonCodec;

        @Option(names = "--plugin-id", required = true)
        String pluginId;

        @Option(names = "--action", required = true)
        String action;

        @Option(names = "--args", defaultValue = "{}")
        String args;

        @Option(names = "--script-input", defaultValue = "{}")
        String scriptInput;

        @Option(names = "--response-view", defaultValue = "RESULT")
        String responseView;

        InvokePlugin(PluginRuntimeService pluginRuntimeService, JsonCodec jsonCodec) {
            this.pluginRuntimeService = pluginRuntimeService;
            this.jsonCodec = jsonCodec;
        }

        @Override
        public void run() {
            Map<String, Object> normalizedArgs = jsonCodec.readMap(args);
            Map<String, Object> normalizedScriptInput = jsonCodec.readMap(scriptInput);
            PluginInvokeView response = pluginRuntimeService.invokeForDebug(
                    pluginId,
                    action,
                    normalizedArgs,
                    normalizedScriptInput,
                    isDebugView(responseView)
            );
            System.out.println(jsonCodec.write(response));
        }

        private boolean isDebugView(String value) {
            String normalized = value == null ? "RESULT" : value.trim().toUpperCase(Locale.ROOT);
            if ("RESULT".equals(normalized)) {
                return false;
            }
            if ("DEBUG".equals(normalized)) {
                return true;
            }
            throw new IllegalArgumentException("responseView 仅支持 RESULT 或 DEBUG");
        }
    }
}
