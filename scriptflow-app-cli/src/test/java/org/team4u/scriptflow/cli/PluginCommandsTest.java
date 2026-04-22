package org.team4u.scriptflow.cli;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.plugin.PluginInvokeDebugView;
import org.team4u.scriptflow.plugin.PluginInvokeView;
import org.team4u.scriptflow.plugin.PluginRuntimeService;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PluginCommandsTest {
    @Test
    void invokePluginPrintsJsonResponse() {
        PluginRuntimeService pluginRuntimeService = mock(PluginRuntimeService.class);
        JsonCodec jsonCodec = mock(JsonCodec.class);
        PluginCommands.InvokePlugin command = new PluginCommands.InvokePlugin(pluginRuntimeService, jsonCodec);
        command.pluginId = "demo-plugin";
        command.action = "echo";
        command.args = "{\"message\":\"hello\"}";
        command.scriptInput = "{\"name\":\"Alice\"}";
        command.responseView = "DEBUG";

        when(jsonCodec.readMap("{\"message\":\"hello\"}")).thenReturn(Map.of("message", "hello"));
        when(jsonCodec.readMap("{\"name\":\"Alice\"}")).thenReturn(Map.of("name", "Alice"));
        PluginInvokeView response = new PluginInvokeView()
                .setPluginId("demo-plugin")
                .setAction("echo")
                .setResult(Map.of("message", "hello:world"))
                .setDebug(new PluginInvokeDebugView()
                        .setArgs(Map.of("message", "hello"))
                        .setScriptInput(Map.of("name", "Alice"))
                        .setRawResult(Map.of("message", "hello:world")));
        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(true)
        )).thenReturn(response);
        when(jsonCodec.write(response)).thenReturn("{\"pluginId\":\"demo-plugin\"}");

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        try {
            System.setOut(new PrintStream(output, true, StandardCharsets.UTF_8));
            command.run();
        } finally {
            System.setOut(originalOut);
        }

        assertThat(output.toString(StandardCharsets.UTF_8)).contains("{\"pluginId\":\"demo-plugin\"}");
    }
}
