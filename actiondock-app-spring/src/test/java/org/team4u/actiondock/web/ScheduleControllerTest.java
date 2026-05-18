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
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.schedule.ScriptScheduleDispatcher;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
                "spring.datasource.url=jdbc:h2:mem:schedule-controller;DB_CLOSE_DELAY=-1",
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
class ScheduleControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScheduleApplicationService scheduleApplicationService;

    @MockBean
    private ScriptScheduleDispatcher scriptScheduleDispatcher;

    @MockBean
    private ExecutionRepository executionRepository;

    @Test
    void listReturnsWrappedSchedules() throws Exception {
        when(scheduleApplicationService.listAll()).thenReturn(List.of(schedule("schedule-1")));
        when(executionRepository.findById("exec-1")).thenReturn(Optional.of(new ExecutionRecord()
                .setId("exec-1")
                .setStatus(ExecutionStatus.SUCCESS)));

        mockMvc.perform(get("/api/schedules"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data[0].id").value("schedule-1"))
                .andExpect(jsonPath("$.data[0].scriptId").value("script-1"))
                .andExpect(jsonPath("$.data[0].lastExecutionStatus").value("SUCCESS"));
    }

    @Test
    void createDelegatesToApplicationServiceAndRefreshesDispatcher() throws Exception {
        when(scheduleApplicationService.save(eq("script-1"), any())).thenReturn(schedule("schedule-1"));

        mockMvc.perform(post("/api/schedules")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"script-1","name":"Nightly","cronExpression":"0 0 2 * * *","input":{"mode":"full"},"enabled":true}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("schedule-1"))
                .andExpect(jsonPath("$.data.scriptId").value("script-1"));

        verify(scriptScheduleDispatcher).refreshScript("script-1");
    }

    @Test
    void detailReturnsWrappedSchedule() throws Exception {
        when(scheduleApplicationService.getById("schedule-1")).thenReturn(schedule("schedule-1"));
        when(executionRepository.findById("exec-1")).thenReturn(Optional.of(new ExecutionRecord()
                .setId("exec-1")
                .setStatus(ExecutionStatus.SUCCESS)));

        mockMvc.perform(get("/api/schedules/schedule-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("schedule-1"))
                .andExpect(jsonPath("$.data.name").value("Nightly"))
                .andExpect(jsonPath("$.data.lastExecutionStatus").value("SUCCESS"));
    }

    @Test
    void updateRejectsCrossScriptMove() throws Exception {
        when(scheduleApplicationService.save(eq("other-script"), any()))
                .thenThrow(ActionDockException.conflict(
                        ActionDockErrorCodes.SCHEDULE_SCRIPT_MISMATCH,
                        "调度不属于该脚本: schedule-1",
                        Map.of("scheduleId", "schedule-1", "scriptId", "other-script")
                ));

        mockMvc.perform(put("/api/schedules/schedule-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"scriptId":"other-script","name":"Nightly","cronExpression":"0 0 2 * * *","input":{},"enabled":true}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.msg").value("调度不属于该脚本: schedule-1"))
                .andExpect(jsonPath("$.data.code").value("SCHEDULE_SCRIPT_MISMATCH"));
    }

    @Test
    void deleteUsesResolvedScriptIdForRefresh() throws Exception {
        when(scheduleApplicationService.getById("schedule-1")).thenReturn(schedule("schedule-1"));

        mockMvc.perform(delete("/api/schedules/schedule-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("已删除"));

        verify(scheduleApplicationService).deleteByScheduleId("schedule-1");
        verify(scriptScheduleDispatcher).refreshScript("script-1");
    }

    private ScriptSchedule schedule(String id) {
        return new ScriptSchedule()
                .setId(id)
                .setScriptId("script-1")
                .setName("Nightly")
                .setCronExpression("0 0 2 * * *")
                .setInput(Map.of("mode", "full"))
                .setEnabled(true)
                .setLastExecutionId("exec-1")
                .setLastTriggeredAt(LocalDateTime.of(2026, 4, 22, 2, 0))
                .setCreatedAt(LocalDateTime.of(2026, 4, 20, 2, 0))
                .setUpdatedAt(LocalDateTime.of(2026, 4, 21, 2, 0));
    }
}
