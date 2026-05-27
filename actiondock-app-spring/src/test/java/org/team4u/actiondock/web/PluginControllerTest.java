package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.plugin.PluginConfigView;
import org.team4u.actiondock.plugin.PluginInvokeDebugView;
import org.team4u.actiondock.plugin.PluginInvokeView;
import org.team4u.actiondock.plugin.PluginReferenceSourceType;
import org.team4u.actiondock.plugin.PluginReferenceView;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginSummaryView;
import org.team4u.actiondock.plugin.PluginView;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
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
@ExtendWith(OutputCaptureExtension.class)
class PluginControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PluginRuntimeService pluginRuntimeService;

    @Test
    void listReturnsPluginDescriptors() throws Exception {
        when(pluginRuntimeService.list()).thenReturn(List.of(
                new PluginSummaryView()
                        .setPluginId("demo-plugin")
                        .setName("Demo")
                        .setDescription("Demo plugin")
                        .setVersion("1.0.0")
                        .setSourceType(PluginReferenceSourceType.SYSTEM)
                        .setState("STARTED")
                        .setStarted(true)
                        .setActionCount(2)
        ));

        mockMvc.perform(get("/api/plugins"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data[0].sourceType").value("SYSTEM"))
                .andExpect(jsonPath("$.data[0].state").value("STARTED"))
                .andExpect(jsonPath("$.data[0].started").value(true))
                .andExpect(jsonPath("$.data[0].actionCount").value(2))
                .andExpect(jsonPath("$.data[0].actions").doesNotExist());
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
    void getMissingPluginReturnsNotFoundWithoutStackTrace() throws Exception {
        when(pluginRuntimeService.get("workspace")).thenThrow(ActionDockException.notFound(
                ActionDockErrorCodes.PLUGIN_NOT_FOUND,
                "插件不存在: workspace",
                Map.of("pluginId", "workspace")
        ));

        mockMvc.perform(get("/api/plugins/workspace"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.msg").value("插件不存在: workspace"))
                .andExpect(jsonPath("$.data.code").value("PLUGIN_NOT_FOUND"))
                .andExpect(jsonPath("$.data.pluginId").value("workspace"))
                .andExpect(jsonPath("$.data.stackTrace").doesNotExist());
    }

    @Test
    void listReferencesReturnsPluginReferences() throws Exception {
        when(pluginRuntimeService.listPluginReferences()).thenReturn(List.of(
                new PluginReferenceView()
                        .setPluginId("actiondock-ai")
                        .setName("ActionDock AI")
                        .setSourceType(PluginReferenceSourceType.SYSTEM)
                        .setStarted(true)
        ));

        mockMvc.perform(get("/api/plugins/references"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].pluginId").value("actiondock-ai"))
                .andExpect(jsonPath("$.data[0].sourceType").value("SYSTEM"))
                .andExpect(jsonPath("$.data[0].started").value(true));
    }

    @Test
    void saveConfigPersistsJsonObject() throws Exception {
        when(pluginRuntimeService.saveConfig("demo-plugin", Map.of("prefix", "hello"))).thenReturn(
                new PluginConfigView()
                        .setPluginId("demo-plugin")
                        .setConfigName("default")
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
    void namedConfigCanBeSavedAndUsedForDebugInvoke() throws Exception {
        when(pluginRuntimeService.saveConfig("demo-plugin", "prod", Map.of("prefix", "live"))).thenReturn(
                new PluginConfigView()
                        .setPluginId("demo-plugin")
                        .setConfigName("prod")
                        .setConfig(Map.of("prefix", "live"))
        );

        mockMvc.perform(put("/api/plugins/demo-plugin/configs/prod")
                        .contentType("application/json")
                        .content("""
                                {"config":{"prefix":"live"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data.configName").value("prod"))
                .andExpect(jsonPath("$.data.config.prefix").value("live"));

        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(false),
                eq("prod")
        )).thenReturn(
                new PluginInvokeView()
                        .setPluginId("demo-plugin")
                        .setAction("echo")
                        .setResult(Map.of("message", "live:hello"))
        );

        mockMvc.perform(post("/api/plugins/demo-plugin/actions/echo/invoke")
                        .contentType("application/json")
                        .content("""
                                {
                                  "args": {"message":"hello"},
                                  "scriptInput": {"name":"Alice"},
                                  "configName": "prod"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.result.message").value("live:hello"));
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
                eq(true),
                eq(null)
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
    void invokeReturnsInternalErrorWithoutResponseStackTrace(CapturedOutput output) throws Exception {
        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(false),
                eq(null)
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
                .andExpect(jsonPath("$.msg").value("服务器内部错误"))
                .andExpect(jsonPath("$.data.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.data.type").doesNotExist())
                .andExpect(jsonPath("$.data.stackTrace").doesNotExist());

        assertThat(output).contains("ERROR");
        assertThat(output).contains("API exception status=500 code=INTERNAL_ERROR method=POST uri=/api/plugins/demo-plugin/actions/echo/invoke message=plugin failed");
    }

    @Test
    void invokeReturnsPluginRuntimeStatusAndCode(CapturedOutput output) throws Exception {
        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(false),
                eq(null)
        )).thenThrow(new org.team4u.actiondock.plugin.api.PluginRuntimeException(
                400,
                "PLUGIN_INVALID_ARGUMENTS",
                "message is required",
                Map.of("pluginId", "demo-plugin", "action", "echo")
        ));

        mockMvc.perform(post("/api/plugins/demo-plugin/actions/echo/invoke")
                        .contentType("application/json")
                        .content("""
                                {
                                  "args": {"message":"hello"},
                                  "scriptInput": {"name":"Alice"},
                                  "responseView": "RESULT"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("message is required"))
                .andExpect(jsonPath("$.data.code").value("PLUGIN_INVALID_ARGUMENTS"))
                .andExpect(jsonPath("$.data.pluginId").value("demo-plugin"))
                .andExpect(jsonPath("$.data.action").value("echo"))
                .andExpect(jsonPath("$.data.stackTrace").doesNotExist());

        assertThat(output).contains("WARN");
        assertThat(output).contains("API exception status=400 code=PLUGIN_INVALID_ARGUMENTS");
    }

    @Test
    void invokeLogsStackTraceForPluginRuntimeExceptionWithCause(CapturedOutput output) throws Exception {
        when(pluginRuntimeService.invokeForDebug(
                eq("demo-plugin"),
                eq("echo"),
                eq(Map.of("message", "hello")),
                eq(Map.of("name", "Alice")),
                eq(false),
                eq(null)
        )).thenThrow(new org.team4u.actiondock.plugin.api.PluginRuntimeException(
                400,
                "PLUGIN_INVALID_ARGUMENTS",
                "message is required",
                Map.of("pluginId", "demo-plugin", "action", "echo"),
                new NullPointerException("plugin arg parsing failed")
        ));

        mockMvc.perform(post("/api/plugins/demo-plugin/actions/echo/invoke")
                        .contentType("application/json")
                        .content("""
                                {
                                  "args": {"message":"hello"},
                                  "scriptInput": {"name":"Alice"},
                                  "responseView": "RESULT"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("message is required"))
                .andExpect(jsonPath("$.data.code").value("PLUGIN_INVALID_ARGUMENTS"))
                .andExpect(jsonPath("$.data.stackTrace").doesNotExist());

        assertThat(output).contains("WARN");
        assertThat(output).contains("API exception status=400 code=PLUGIN_INVALID_ARGUMENTS");
        assertThat(output).contains("java.lang.NullPointerException: plugin arg parsing failed");
    }

    @Test
    void installLogsBadRequestWhenPluginValidationFails(CapturedOutput output) throws Exception {
        when(pluginRuntimeService.install(eq("demo.jar"), any(byte[].class)))
                .thenThrow(new IllegalArgumentException("bad plugin"));

        mockMvc.perform(multipart("/api/plugins/install")
                        .file(new MockMultipartFile("file", "demo.jar", "application/java-archive", "jar".getBytes())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("bad plugin"))
                .andExpect(jsonPath("$.data.code").value("BAD_REQUEST"))
                .andExpect(jsonPath("$.data.stackTrace").doesNotExist());

        assertThat(output).contains("WARN");
        assertThat(output).contains("API exception status=400 code=BAD_REQUEST method=POST uri=/api/plugins/install message=bad plugin");
    }
}
