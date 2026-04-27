package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.workbench.AiWorkbenchCommand;
import org.team4u.actiondock.ai.workbench.AiWorkbenchResult;
import org.team4u.actiondock.ai.workbench.AiWorkbenchService;
import org.team4u.actiondock.ai.workbench.AiWorkbenchTaskType;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:ai-workbench-controller;DB_CLOSE_DELAY=-1",
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
class AiWorkbenchControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AiWorkbenchService workbenchService;

    @Test
    void generateScriptReturnsStructuredWorkbenchResult() throws Exception {
        when(workbenchService.generateScript(any())).thenReturn(result(AiWorkbenchTaskType.GENERATE_SCRIPT, "scriptDraft", Map.of("id", "hello-ai")));

        mockMvc.perform(post("/api/ai/workbench/scripts/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"objective\":\"build\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskType").value("GENERATE_SCRIPT"))
                .andExpect(jsonPath("$.data.status").value("SUCCESS"))
                .andExpect(jsonPath("$.data.result.id").value("hello-ai"))
                .andExpect(jsonPath("$.data.agentRunId").value("run-1"))
                .andExpect(jsonPath("$.data.rawOutput.scriptDraft.id").value("hello-ai"));
    }

    @Test
    void improveScriptEndpointDelegates() throws Exception {
        when(workbenchService.improveScript(any())).thenReturn(result(AiWorkbenchTaskType.IMPROVE_SCRIPT, "scriptPatch", Map.of("patch", "---")));

        mockMvc.perform(post("/api/ai/workbench/scripts/improve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"scriptId\":\"script-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskType").value("IMPROVE_SCRIPT"))
                .andExpect(jsonPath("$.data.result.patch").value("---"));
    }

    @Test
    void improveSchemaEndpointDelegates() throws Exception {
        when(workbenchService.improveSchema(any())).thenReturn(result(AiWorkbenchTaskType.IMPROVE_SCHEMA, "schemaPatch", Map.of("rationale", "schema")));

        mockMvc.perform(post("/api/ai/workbench/schemas/improve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"scriptId\":\"script-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskType").value("IMPROVE_SCHEMA"))
                .andExpect(jsonPath("$.data.result.rationale").value("schema"));
    }

    @Test
    void diagnoseExecutionEndpointUsesPathExecutionId() throws Exception {
        when(workbenchService.diagnoseExecution(eq("exec-1"), any(AiWorkbenchCommand.class)))
                .thenReturn(result(AiWorkbenchTaskType.DIAGNOSE_EXECUTION, "executionDiagnosis", Map.of("rootCause", "boom")));

        mockMvc.perform(post("/api/ai/workbench/executions/exec-1/diagnose")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskType").value("DIAGNOSE_EXECUTION"))
                .andExpect(jsonPath("$.data.result.rootCause").value("boom"));
    }

    @Test
    void reviewBeforePublishEndpointUsesPathScriptId() throws Exception {
        when(workbenchService.reviewBeforePublish(eq("script-1"), any(AiWorkbenchCommand.class)))
                .thenReturn(result(AiWorkbenchTaskType.REVIEW_BEFORE_PUBLISH, "publishReview", Map.of("recommendation", "approve")));

        mockMvc.perform(post("/api/ai/workbench/scripts/script-1/review-publish")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskType").value("REVIEW_BEFORE_PUBLISH"))
                .andExpect(jsonPath("$.data.result.recommendation").value("approve"));
    }

    @Test
    void releaseNotesEndpointUsesPathScriptId() throws Exception {
        when(workbenchService.generateReleaseNotes(eq("script-1"), any(AiWorkbenchCommand.class)))
                .thenReturn(result(AiWorkbenchTaskType.GENERATE_RELEASE_NOTES, "releaseNotes", Map.of("notes", "ship it")));

        mockMvc.perform(post("/api/ai/workbench/scripts/script-1/release-notes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskType").value("GENERATE_RELEASE_NOTES"))
                .andExpect(jsonPath("$.data.result.notes").value("ship it"));
    }

    @Test
    void missingScriptErrorIsMappedClearly() throws Exception {
        when(workbenchService.reviewBeforePublish(eq("missing"), any(AiWorkbenchCommand.class)))
                .thenThrow(new IllegalArgumentException("脚本不存在: missing"));

        mockMvc.perform(post("/api/ai/workbench/scripts/missing/review-publish")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("脚本不存在: missing"));
    }

    private AiWorkbenchResult result(AiWorkbenchTaskType taskType, String key, Map<String, Object> payload) {
        return new AiWorkbenchResult(
                taskType,
                AiRunStatus.SUCCESS,
                payload,
                "run-1",
                List.of(),
                Map.of(key, payload),
                null
        );
    }
}
