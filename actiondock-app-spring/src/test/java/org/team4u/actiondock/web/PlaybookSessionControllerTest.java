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
import org.team4u.actiondock.application.PlaybookSessionApplicationService;
import org.team4u.actiondock.domain.model.PlaybookPhase;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookSessionStatus;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;
import org.team4u.actiondock.domain.model.PlaybookTraceEventType;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
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
                "spring.datasource.url=jdbc:h2:mem:playbook-session-controller;DB_CLOSE_DELAY=-1",
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
class PlaybookSessionControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PlaybookSessionApplicationService service;

    @Test
    void startsSession() throws Exception {
        when(service.startSession(eq("refund"), any(), any())).thenReturn(session());

        mockMvc.perform(post("/api/playbooks/refund/sessions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userPrompt":"rf_123","intent":"refund","agentName":"cursor","agentRunId":"run-1","candidatePlaybookIds":["refund"]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("pbs-1"))
                .andExpect(jsonPath("$.data.playbookId").value("refund"))
                .andExpect(jsonPath("$.data.riskLevelSnapshot").value("MEDIUM"));

        verify(service).startSession(eq("refund"), any(), any());
    }

    @Test
    void appendsEventAndReturnsCompactResponse() throws Exception {
        when(service.appendEvent(eq("pbs-1"), any())).thenReturn(new PlaybookTraceEvent()
                .setId("pbe-1")
                .setSessionId("pbs-1")
                .setSequence(4)
                .setPhase(PlaybookPhase.BOUND)
                .setType(PlaybookTraceEventType.STOP_CONDITION_CHECKED));

        mockMvc.perform(post("/api/playbook-sessions/pbs-1/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"phase":"BOUND","type":"STOP_CONDITION_CHECKED","decision":"passed","payload":{"field":"refundId"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.eventId").value("pbe-1"))
                .andExpect(jsonPath("$.data.sessionId").value("pbs-1"))
                .andExpect(jsonPath("$.data.sequence").value(4));
    }

    @Test
    void getsSessionWithEventsAndCompletes() throws Exception {
        when(service.getSession("pbs-1")).thenReturn(session().setStatus(PlaybookSessionStatus.COMPLETED));
        when(service.listEvents("pbs-1")).thenReturn(List.of(new PlaybookTraceEvent()
                .setId("pbe-1")
                .setSessionId("pbs-1")
                .setSequence(1)
                .setPhase(PlaybookPhase.ROUTE)
                .setType(PlaybookTraceEventType.SESSION_STARTED)));
        when(service.completeSession(eq("pbs-1"), eq(PlaybookSessionStatus.COMPLETED), eq("done"), any()))
                .thenReturn(session().setStatus(PlaybookSessionStatus.COMPLETED).setFinalSummary("done"));

        mockMvc.perform(get("/api/playbook-sessions/pbs-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.session.id").value("pbs-1"))
                .andExpect(jsonPath("$.data.events[0].type").value("SESSION_STARTED"));

        mockMvc.perform(post("/api/playbook-sessions/pbs-1/complete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"COMPLETED","finalSummary":"done"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("COMPLETED"))
                .andExpect(jsonPath("$.data.finalSummary").value("done"));
    }

    @Test
    void listsSessions() throws Exception {
        when(service.listSessions("refund", PlaybookSessionStatus.RUNNING, "run-1", "refund"))
                .thenReturn(List.of(session().setAgentRunId("run-1")));

        mockMvc.perform(get("/api/playbook-sessions")
                        .param("playbookId", "refund")
                        .param("status", "RUNNING")
                        .param("agentRunId", "run-1")
                        .param("intent", "refund"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("pbs-1"))
                .andExpect(jsonPath("$.data[0].playbookId").value("refund"))
                .andExpect(jsonPath("$.data[0].status").value("RUNNING"));

        verify(service).listSessions("refund", PlaybookSessionStatus.RUNNING, "run-1", "refund");
    }

    private PlaybookSession session() {
        return new PlaybookSession()
                .setId("pbs-1")
                .setPlaybookId("refund")
                .setPlaybookName("Refund")
                .setRepositoryIds(List.of("billing"))
                .setRiskLevelSnapshot(PlaybookRiskLevel.MEDIUM)
                .setStopConditionsSnapshot(List.of("缺少上下文"))
                .setStatus(PlaybookSessionStatus.RUNNING)
                .setCurrentPhase(PlaybookPhase.ROUTE)
                .setStartedAt(LocalDateTime.of(2026, 6, 5, 10, 0));
    }
}
