package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryScriptService;

import java.time.LocalDateTime;
import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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

    @MockBean
    private RepositoryCatalogService repositoryCatalogService;

    @MockBean
    private RepositoryScriptService repositoryToolService;

    @Test
    void detailReturnsWrappedScriptDefinition() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setSource("return [message: 'hi']"));

        mockMvc.perform(get("/api/scripts/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Hello"))
                .andExpect(jsonPath("$.data.source").value("return [message: 'hi']"));
    }

    @Test
    void publishedDetailReturnsWrappedPublishedDefinition() throws Exception {
        when(scriptApplicationService.getPublished("script-1"))
                .thenReturn(publishedScript("script-1", "Live", "return [message: 'live']"));

        mockMvc.perform(get("/api/scripts/script-1/published"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Live"))
                .andExpect(jsonPath("$.data.source").value("return [message: 'live']"));
    }

    @Test
    void upstreamStatusReturnsNullWhenScriptHasNoBinding() throws Exception {
        when(repositoryToolService.getUpstreamStatus("script-1")).thenReturn(null);

        mockMvc.perform(get("/api/scripts/script-1/upstream"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    void detailKeepsPublishedSnapshotSource() throws Exception {
        ScriptDefinition script = new ScriptDefinition()
                .setId("script-1")
                .setName("Live")
                .setSource("return [message: 'draft']")
                .setInputSchema(Map.of("type", "object"))
                .setOutputSchema(Map.of("type", "object"))
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("revision-1")
                        .setScriptId("script-1")
                        .setVersion(1)
                        .setName("Live")
                        .setSource("return [message: 'live']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")));
        when(scriptApplicationService.get("script-1")).thenReturn(script);

        mockMvc.perform(get("/api/scripts/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source").value("return [message: 'draft']"))
                .andExpect(jsonPath("$.data.published.source").value("return [message: 'live']"));
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
    void patchUpdatesOnlySourceWithoutResettingOtherFields() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setName("Original")
                .setSource("return [message: 'old']")
                .setInputSchema(Map.of("type", "object", "properties", Map.of("name", Map.of("type", "string"))))
                .setOutputSchema(Map.of("type", "object", "properties", Map.of("message", Map.of("type", "string"))))
                .setDescription("desc")
                .setOwner("alice"));
        when(scriptApplicationService.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/scripts/script-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"source":"return [message: 'new']"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.source").value("return [message: 'new']"))
                .andExpect(jsonPath("$.data.inputSchema.properties.name.type").value("string"))
                .andExpect(jsonPath("$.data.outputSchema.properties.message.type").value("string"))
                .andExpect(jsonPath("$.data.owner").value("alice"));

        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<ScriptDefinition> captor = org.mockito.ArgumentCaptor.forClass(ScriptDefinition.class);
        verify(scriptApplicationService, atLeastOnce()).save(captor.capture());
        java.util.List<ScriptDefinition> savedValues = captor.getAllValues();
        ScriptDefinition saved = savedValues.get(savedValues.size() - 1);
        assertThat(saved.getSource()).isEqualTo("return [message: 'new']");
        assertThat(saved.getInputSchema()).containsKey("properties");
        assertThat(saved.getOutputSchema()).containsKey("properties");
        assertThat(saved.getDescription()).isEqualTo("desc");
    }

    @Test
    void patchMergesNestedSchemaObjects() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setSource("return [message: 'ok']")
                .setInputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "name", Map.of("type", "string"),
                                "count", Map.of("type", "integer")
                        ),
                        "required", java.util.List.of("name")
                )));
        when(scriptApplicationService.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(patch("/api/scripts/script-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "inputSchema": {
                                    "properties": {
                                      "count": null,
                                      "enabled": { "type": "boolean" }
                                    },
                                    "required": ["name", "enabled"]
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.inputSchema.properties.name.type").value("string"))
                .andExpect(jsonPath("$.data.inputSchema.properties.count").doesNotExist())
                .andExpect(jsonPath("$.data.inputSchema.properties.enabled.type").value("boolean"))
                .andExpect(jsonPath("$.data.inputSchema.required[0]").value("name"))
                .andExpect(jsonPath("$.data.inputSchema.required[1]").value("enabled"));
    }

    @Test
    void patchRejectsFieldsOutsideWhitelist() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition().setId("script-1"));

        mockMvc.perform(patch("/api/scripts/script-1")
                        .contentType(MediaType.APPLICATION_JSON)
                .content("""
                                {"status":"PUBLISHED","source":"return [:]"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("脚本 Patch 仅允许更新以下字段: source, pythonRequirements, inputSchema, outputSchema"))
                .andExpect(jsonPath("$.data.code").value("INVALID_SCRIPT_PATCH"))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"))
                .andExpect(jsonPath("$.data.rejectedFields[0]").value("status"))
                .andExpect(jsonPath("$.data.allowedFields[0]").value("source"))
                .andExpect(jsonPath("$.data.allowedFields[1]").value("pythonRequirements"))
                .andExpect(jsonPath("$.data.allowedFields[2]").value("inputSchema"))
                .andExpect(jsonPath("$.data.allowedFields[3]").value("outputSchema"));
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
                        .setLogs(java.util.List.of(new ExecutionLogEntry()
                                .setLevel(ExecutionLogLevel.INFO)
                                .setMessage("published")
                                .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))))
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
                .andExpect(jsonPath("$.data.logs[0].message").value("published"))
                .andExpect(jsonPath("$.data.output.message").value("live"));
    }

    @Test
    void executeDefaultsToPublishedVersion() throws Exception {
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC)))
                .thenReturn(new ExecutionRecord()
                        .setId("exec-published")
                        .setScriptId("script-1")
                        .setStatus(ExecutionStatus.SUCCESS)
                        .setSubmitMode(SubmitMode.SYNC)
                        .setOutput(Map.of("message", "live")));
        when(scriptApplicationService.getPublished("script-1"))
                .thenReturn(new ScriptDefinition()
                        .setId("script-1")
                        .setOutputSchema(Map.of(
                                "type", "object",
                                "properties", Map.of("message", Map.of("type", "string"))
                        )));

        mockMvc.perform(post("/api/scripts/script-1/execute")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"other","input":{"name":"Alice"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("exec-published"))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"))
                .andExpect(jsonPath("$.data.output.message").value("live"));
    }

    @Test
    void executeDraftUsesDraftDefinitionAndPathId() throws Exception {
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.ASYNC)))
                .thenReturn(new ExecutionRecord()
                        .setId("exec-draft")
                        .setScriptId("script-1")
                        .setStatus(ExecutionStatus.RUNNING)
                        .setSubmitMode(SubmitMode.ASYNC));
        when(scriptApplicationService.get("script-1"))
                .thenReturn(new ScriptDefinition()
                        .setId("script-1")
                        .setOutputSchema(Map.of(
                                "type", "object",
                                "properties", Map.of("debug", Map.of("type", "string"))
                        )));

        mockMvc.perform(post("/api/scripts/script-1/execute")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"other","draft":true,"mode":"ASYNC","responseView":"DEBUG"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("exec-draft"))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"))
                .andExpect(jsonPath("$.data.submitMode").value("ASYNC"))
                .andExpect(jsonPath("$.data.status").value("RUNNING"));
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

    private static ScriptDefinition publishedScript(String id, String name, String source) {
        ScriptDefinition script = new ScriptDefinition()
                .setId(id)
                .setName(name)
                .setSource(source)
                .setInputSchema(Map.of())
                .setOutputSchema(Map.of());
        script.setPublishedRevision(PublishedScriptRevision.fromDraft(script, id + ":published:1", 1, LocalDateTime.now()));
        return script;
    }
}
