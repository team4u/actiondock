package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import org.team4u.actiondock.application.InvalidExecutionInputException;
import org.team4u.actiondock.application.SchemaFieldError;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.SubmitMode;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:execution-controller;DB_CLOSE_DELAY=-1",
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
class ExecutionControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ExecutionApplicationService executionApplicationService;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @Test
    void executeUsesSyncModeByDefault() throws Exception {
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.SYNC)
                .setInput(Map.of("name", "Alice"))
                .setLogs(List.of(new ExecutionLogEntry()
                        .setLevel(ExecutionLogLevel.INFO)
                        .setMessage("hello")
                        .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))))
                .setOutput(Map.of("message", "Hello", "secret", "token")));
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("message", Map.of("type", "string"))
                )));

        mockMvc.perform(post("/api/executions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"script-1","input":{"name":"Alice"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("已受理"))
                .andExpect(jsonPath("$.data.id").value("exec-1"))
                .andExpect(jsonPath("$.data.output.message").value("Hello"))
                .andExpect(jsonPath("$.data.output.secret").doesNotExist())
                .andExpect(jsonPath("$.data.input").doesNotExist())
                .andExpect(jsonPath("$.data.debug").doesNotExist());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> inputCaptor = ArgumentCaptor.forClass(Map.class);
        verify(executionApplicationService).execute(eq("script-1"), inputCaptor.capture(), eq(SubmitMode.SYNC));
        assertThat(inputCaptor.getValue()).containsEntry("name", "Alice");
    }

    @Test
    void executeIncludesRawInputAndOutputInDebugView() throws Exception {
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.SYNC)
                .setInput(Map.of("name", "Alice"))
                .setLogs(List.of(new ExecutionLogEntry()
                        .setLevel(ExecutionLogLevel.INFO)
                        .setMessage("hello")
                        .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))))
                .setOutput(Map.of("message", "Hello", "secret", "token")));
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("message", Map.of("type", "string"))
                )));

        mockMvc.perform(post("/api/executions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"script-1","input":{"name":"Alice"},"responseView":"DEBUG"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.output.message").value("Hello"))
                .andExpect(jsonPath("$.data.logs[0].level").value("INFO"))
                .andExpect(jsonPath("$.data.logs[0].message").value("hello"))
                .andExpect(jsonPath("$.data.debug.input.name").value("Alice"))
                .andExpect(jsonPath("$.data.debug.rawOutput.message").value("Hello"))
                .andExpect(jsonPath("$.data.debug.rawOutput.secret").value("token"));
    }

    @Test
    void executeReturnsStructuredErrorDetailForFailedExecution() throws Exception {
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.FAILED)
                .setSubmitMode(SubmitMode.SYNC)
                .setInput(Map.of("name", "Alice"))
                .setOutput(Map.of())
                .setErrorMessage("boom")
                .setErrorDetail(new ErrorDetail()
                        .setType("java.lang.IllegalStateException")
                        .setStackTrace("java.lang.IllegalStateException: boom")));
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setOutputSchema(Map.of("type", "object")));

        mockMvc.perform(post("/api/executions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"script-1","input":{"name":"Alice"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FAILED"))
                .andExpect(jsonPath("$.data.errorMessage").value("boom"))
                .andExpect(jsonPath("$.data.errorDetail.type").value("java.lang.IllegalStateException"))
                .andExpect(jsonPath("$.data.errorDetail.stackTrace").value("java.lang.IllegalStateException: boom"));
    }

    @Test
    void listPassesScriptIdFilterThrough() throws Exception {
        when(executionApplicationService.list("script-1")).thenReturn(List.of(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.SYNC)
                .setInput(Map.of("name", "Alice"))
                .setOutput(Map.of("message", "Hello", "secret", "token"))));
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("message", Map.of("type", "string"))
                )));

        mockMvc.perform(get("/api/executions").queryParam("scriptId", "script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("exec-1"))
                .andExpect(jsonPath("$.data[0].input.name").value("Alice"))
                .andExpect(jsonPath("$.data[0].output.message").value("Hello"))
                .andExpect(jsonPath("$.data[0].output.secret").doesNotExist());
    }

    @Test
    void listByScheduleProjectsOutputUsingEachExecutionScriptSchema() throws Exception {
        when(executionApplicationService.listByScheduleId("schedule-1")).thenReturn(List.of(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.SYNC)
                .setOutput(Map.of("message", "Hello", "secret", "token"))));
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("message", Map.of("type", "string"))
                )));

        mockMvc.perform(get("/api/executions").queryParam("scheduleId", "schedule-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].output.message").value("Hello"))
                .andExpect(jsonPath("$.data[0].output.secret").doesNotExist());
    }

    @Test
    void detailProjectsOutputButKeepsInputForHistoryRefill() throws Exception {
        when(executionApplicationService.get("exec-1")).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.SYNC)
                .setInput(Map.of("name", "Alice"))
                .setOutput(Map.of("message", "Hello", "secret", "token")));
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("message", Map.of("type", "string"))
                )));

        mockMvc.perform(get("/api/executions/exec-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("exec-1"))
                .andExpect(jsonPath("$.data.input.name").value("Alice"))
                .andExpect(jsonPath("$.data.output.message").value("Hello"))
                .andExpect(jsonPath("$.data.output.secret").doesNotExist())
                .andExpect(jsonPath("$.data.debug").doesNotExist());
    }

    @Test
    void detailFallsBackToRawOutputWhenScriptDefinitionIsMissing() throws Exception {
        when(executionApplicationService.get("exec-1")).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("deleted-script")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.SYNC)
                .setOutput(Map.of("message", "Hello", "secret", "token")));
        when(scriptApplicationService.get("deleted-script"))
                .thenThrow(new IllegalArgumentException("脚本不存在: deleted-script"));

        mockMvc.perform(get("/api/executions/exec-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.output.message").value("Hello"))
                .andExpect(jsonPath("$.data.output.secret").value("token"));
    }

    @Test
    void detailMapsMissingExecutionToNotFound() throws Exception {
        when(executionApplicationService.get("missing")).thenThrow(ActionDockException.notFound(
                ActionDockErrorCodes.EXECUTION_NOT_FOUND,
                "执行记录不存在: missing",
                Map.of("executionId", "missing")
        ));

        mockMvc.perform(get("/api/executions/missing"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.msg").value("执行记录不存在: missing"))
                .andExpect(jsonPath("$.data.code").value("EXECUTION_NOT_FOUND"))
                .andExpect(jsonPath("$.data.executionId").value("missing"))
                .andExpect(jsonPath("$.data.stackTrace").doesNotExist());
    }

    @Test
    void executeReturnsStructuredValidationError() throws Exception {
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC)))
                .thenThrow(new InvalidExecutionInputException("script-1", List.of(
                        new SchemaFieldError("name", "required", "Name 为必填", "present", "missing")
                )));

        mockMvc.perform(post("/api/executions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"script-1","input":{}}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("脚本 script-1 输入参数校验失败: Name 为必填"))
                .andExpect(jsonPath("$.data.code").value("INVALID_ARGUMENTS"))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"))
                .andExpect(jsonPath("$.data.fieldErrors[0].field").value("name"))
                .andExpect(jsonPath("$.data.fieldErrors[0].message").value("Name 为必填"));
    }

    @Test
    void deleteRemovesSingleExecution() throws Exception {
        doNothing().when(executionApplicationService).delete("exec-1");

        mockMvc.perform(delete("/api/executions/exec-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("已删除"));

        verify(executionApplicationService).delete("exec-1");
    }

    @Test
    void clearRemovesExecutionHistoryForScript() throws Exception {
        doNothing().when(executionApplicationService).clear("script-1");

        mockMvc.perform(delete("/api/executions").queryParam("scriptId", "script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("已清空"));

        verify(executionApplicationService).clear("script-1");
    }
}
