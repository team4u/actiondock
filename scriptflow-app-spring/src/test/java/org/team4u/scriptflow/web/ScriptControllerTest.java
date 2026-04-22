package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.RuntimeApplication;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.model.SubmitMode;

import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:script-controller;DB_CLOSE_DELAY=-1",
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
class ScriptControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @MockBean
    private ExecutionApplicationService executionApplicationService;

    @Test
    void detailReturnsWrappedScriptDefinition() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition().setId("script-1").setName("Hello"));

        mockMvc.perform(get("/api/scripts/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Hello"));
    }

    @Test
    void publishedDetailReturnsWrappedPublishedDefinition() throws Exception {
        when(scriptApplicationService.getPublished("script-1"))
                .thenReturn(new ScriptDefinition()
                        .setId("script-1")
                        .setName("Live")
                        .setStatus(ScriptStatus.PUBLISHED));

        mockMvc.perform(get("/api/scripts/script-1/published"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Live"))
                .andExpect(jsonPath("$.data.status").value("PUBLISHED"));
    }

    @Test
    void detailStripsUiFieldsFromSchemaByDefault() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setInputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "name", Map.of(
                                        "type", "string",
                                        "title", "Name",
                                        "x-ui", Map.of("widget", "textarea", "rows", 4),
                                        "ui", Map.of("component", "input")
                                )
                        )
                )));

        mockMvc.perform(get("/api/scripts/script-1"))
                .andExpect(status().isOk())
                .andExpect(content().string(not(containsString("\"x-ui\""))))
                .andExpect(content().string(not(containsString("\"ui\""))))
                .andExpect(jsonPath("$.data.inputSchema.properties.name.type").value("string"));
    }

    @Test
    void detailKeepsUiFieldsWhenExplicitlyRequested() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setInputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "name", Map.of(
                                        "type", "string",
                                        "x-ui", Map.of("widget", "textarea", "rows", 4)
                                )
                        )
                )));

        mockMvc.perform(get("/api/scripts/script-1").param("includeUiSchema", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.inputSchema.properties.name.x-ui.widget").value("textarea"))
                .andExpect(jsonPath("$.data.inputSchema.properties.name.x-ui.rows").value(4));
    }

    @Test
    void updateUsesPathIdInsteadOfRequestBodyId() throws Exception {
        when(scriptApplicationService.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(put("/api/scripts/script-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"other","name":"Updated","source":"return [:]"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Updated"));

        verify(scriptApplicationService).save(any(ScriptDefinition.class));
    }

    @Test
    void discardDraftDelegatesToApplicationService() throws Exception {
        when(scriptApplicationService.discardDraft("script-1"))
                .thenReturn(new ScriptDefinition().setId("script-1").setName("Live"));

        mockMvc.perform(post("/api/scripts/script-1/discard-draft"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Live"));
    }

    @Test
    void publishedExecuteUsesPathIdAndPublishedSchemaProjection() throws Exception {
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC)))
                .thenReturn(new ExecutionRecord()
                        .setId("exec-1")
                        .setScriptId("script-1")
                        .setStatus(ExecutionStatus.SUCCESS)
                        .setSubmitMode(SubmitMode.SYNC)
                        .setOutput(Map.of("message", "live")));
        when(scriptApplicationService.getPublished("script-1"))
                .thenReturn(new ScriptDefinition()
                        .setId("script-1")
                        .setOutputSchema(Map.of(
                                "type", "object",
                                "properties", Map.of(
                                        "message", Map.of("type", "string")
                                )
                        )));

        mockMvc.perform(post("/api/scripts/script-1/published/execute")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"other","input":{"name":"Alice"},"mode":"SYNC"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.id").value("exec-1"))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"))
                .andExpect(jsonPath("$.data.output.message").value("live"));
    }

    @Test
    void validateMapsIllegalArgumentToBadRequest() throws Exception {
        org.mockito.Mockito.doThrow(new IllegalArgumentException("missing"))
                .when(scriptApplicationService).validate("missing");

        mockMvc.perform(post("/api/scripts/missing/validate"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("missing"));
    }
}
