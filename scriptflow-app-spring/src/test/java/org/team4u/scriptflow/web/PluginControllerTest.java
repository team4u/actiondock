package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.RuntimeApplication;
import org.team4u.scriptflow.plugin.PluginConfigView;
import org.team4u.scriptflow.plugin.PluginInvokeDebugView;
import org.team4u.scriptflow.plugin.PluginInvokeView;
import org.team4u.scriptflow.plugin.PluginRuntimeService;
import org.team4u.scriptflow.plugin.PluginView;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:plugin-controller;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.jpa.open-in-view=false",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
@AutoConfigureMockMvc
@Import(GlobalExceptionHandler.class)
class PluginControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PluginRuntimeService pluginRuntimeService;

    @Test
    void listReturnsPluginDescriptors() throws Exception {
        when(pluginRuntimeService.list()).thenReturn(List.of(
                new PluginView()
                        .setPluginId("demo-plugin")
                        .setName("Demo")
                        .setDescription("Demo plugin")
                        .setVersion("1.0.0")
                        .setState("STARTED")
                        .setStarted(true)
        ));

        mockMvc.perform(get("/api/plugins"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data[0].state").value("STARTED"))
                .andExpect(jsonPath("$.data[0].started").value(true));
    }

    @Test
    void getReturnsSinglePluginDescriptor() throws Exception {
        when(pluginRuntimeService.get("demo-plugin")).thenReturn(
                new PluginView()
                        .setPluginId("demo-plugin")
                        .setName("Demo")
                        .setVersion("1.0.0")
                        .setState("STARTED")
                        .setStarted(true)
        );

        mockMvc.perform(get("/api/plugins/demo-plugin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data.version").value("1.0.0"));
    }

    @Test
    void saveConfigPersistsJsonObject() throws Exception {
        when(pluginRuntimeService.saveConfig("demo-plugin", Map.of("prefix", "hello"))).thenReturn(
                new PluginConfigView()
                        .setPluginId("demo-plugin")
                        .setConfig(Map.of("prefix", "hello"))
        );

        mockMvc.perform(put("/api/plugins/demo-plugin/config")
                        .contentType("application/json")
                        .content("""
                                {"config":{"prefix":"hello"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data.config.prefix").value("hello"));
    }

    @Test
    void upgradeReturnsUpdatedPlugin() throws Exception {
        when(pluginRuntimeService.upgrade(eq("demo-plugin"), eq("demo.jar"), any(byte[].class))).thenReturn(
                new PluginView()
                        .setPluginId("demo-plugin")
                        .setName("Demo")
                        .setVersion("2.0.0")
                        .setState("STARTED")
                        .setStarted(true)
        );

        mockMvc.perform(multipart("/api/plugins/demo-plugin/upgrade")
                        .file(new MockMultipartFile("file", "demo.jar", "application/java-archive", "jar".getBytes())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data.version").value("2.0.0"));
    }

    @Test
    void invokeReturnsPluginResultAndDebugPayload() throws Exception {
        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(true)
        )).thenReturn(
                new PluginInvokeView()
                        .setPluginId("demo-plugin")
                        .setAction("echo")
                        .setResult(Map.of("message", "hello:world"))
                        .setDebug(new PluginInvokeDebugView()
                                .setArgs(Map.of("message", "hello"))
                                .setScriptInput(Map.of("name", "Alice")))
        );

        mockMvc.perform(post("/api/plugins/demo-plugin/actions/echo/invoke")
                        .contentType("application/json")
                        .content("""
                                {
                                  "args": {"message":"hello"},
                                  "scriptInput": {"name":"Alice"},
                                  "responseView": "DEBUG"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data.action").value("echo"))
                .andExpect(jsonPath("$.data.result.message").value("hello:world"))
                .andExpect(jsonPath("$.data.debug.args.message").value("hello"))
                .andExpect(jsonPath("$.data.debug.scriptInput.name").value("Alice"));
    }

    @Test
    void invokeReturnsStructuredErrorDetailWhenPluginFails() throws Exception {
        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(false)
        )).thenThrow(new IllegalStateException("plugin failed"));

        mockMvc.perform(post("/api/plugins/demo-plugin/actions/echo/invoke")
                        .contentType("application/json")
                        .content("""
                                {
                                  "args": {"message":"hello"},
                                  "scriptInput": {"name":"Alice"},
                                  "responseView": "RESULT"
                                }
                                """))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.status").value(500))
                .andExpect(jsonPath("$.msg").value("plugin failed"))
                .andExpect(jsonPath("$.data.type").value("java.lang.IllegalStateException"))
                .andExpect(jsonPath("$.data.stackTrace").exists());
    }
}
