package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.SubmitMode;

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

@WebMvcTest(ExecutionController.class)
@Import(GlobalExceptionHandler.class)
class ExecutionControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ExecutionApplicationService executionApplicationService;

    @Test
    void executeUsesSyncModeByDefault() throws Exception {
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setStatus(ExecutionStatus.SUCCESS));

        mockMvc.perform(post("/api/executions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"script-1","input":{"name":"Alice"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("已受理"))
                .andExpect(jsonPath("$.data.id").value("exec-1"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> inputCaptor = ArgumentCaptor.forClass(Map.class);
        verify(executionApplicationService).execute(eq("script-1"), inputCaptor.capture(), eq(SubmitMode.SYNC));
        assertThat(inputCaptor.getValue()).containsEntry("name", "Alice");
    }

    @Test
    void listPassesScriptIdFilterThrough() throws Exception {
        when(executionApplicationService.list("script-1")).thenReturn(List.of(new ExecutionRecord().setId("exec-1")));

        mockMvc.perform(get("/api/executions").queryParam("scriptId", "script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("exec-1"));
    }

    @Test
    void detailMapsMissingExecutionToBadRequest() throws Exception {
        when(executionApplicationService.get("missing")).thenThrow(new IllegalArgumentException("Execution not found: missing"));

        mockMvc.perform(get("/api/executions/missing"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("Execution not found: missing"));
    }

    @Test
    void deleteRemovesSingleExecution() throws Exception {
        doNothing().when(executionApplicationService).delete("exec-1");

        mockMvc.perform(delete("/api/executions/exec-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("删除成功"));

        verify(executionApplicationService).delete("exec-1");
    }

    @Test
    void clearRemovesExecutionHistoryForScript() throws Exception {
        doNothing().when(executionApplicationService).clear("script-1");

        mockMvc.perform(delete("/api/executions").queryParam("scriptId", "script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("清空成功"));

        verify(executionApplicationService).clear("script-1");
    }
}
