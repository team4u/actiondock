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
import org.team4u.actiondock.application.EventIngestionApplicationService;
import org.team4u.actiondock.application.EventIngestionResult;
import org.team4u.actiondock.application.WebhookRequestHeadersTooLargeException;
import org.team4u.actiondock.application.WebhookRequestPayloadTooLargeException;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.EventWebhookResponsePayload;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
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
                "spring.datasource.url=jdbc:h2:mem:event-ingestion-controller;DB_CLOSE_DELAY=-1",
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
class EventIngestionControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private EventIngestionApplicationService eventIngestionApplicationService;

    @MockBean
    private ApiAccessTokenRepository apiAccessTokenRepository;

    @Test
    void webhookRouteBypassesGlobalApiKeyFilter() throws Exception {
        when(apiAccessTokenRepository.count()).thenReturn(1L);
        when(eventIngestionApplicationService.ingest(eq("source-1"), any())).thenReturn(new EventIngestionResult()
                .setEventRecord(new EventRecord()
                        .setId("event-1")
                        .setSourceId("source-1")
                        .setSourceKey("source-key")
                        .setStatus(EventRecordStatus.IGNORED)
                        .setCreatedAt(LocalDateTime.now()))
                .setDispatches(List.of()));

        mockMvc.perform(post("/api/event-sources/source-1/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("已接收"))
                .andExpect(jsonPath("$.data.event.id").value("event-1"));

        verify(eventIngestionApplicationService).ingest(eq("source-1"), any());
    }

    @Test
    void payloadTooLargeIsMappedTo413() throws Exception {
        when(apiAccessTokenRepository.count()).thenReturn(1L);
        when(eventIngestionApplicationService.ingest(eq("source-1"), any()))
                .thenThrow(new WebhookRequestPayloadTooLargeException("请求体过大"));

        mockMvc.perform(post("/api/event-sources/source-1/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.status").value(413));
    }

    @Test
    void headersTooLargeIsMappedTo431() throws Exception {
        when(apiAccessTokenRepository.count()).thenReturn(1L);
        when(eventIngestionApplicationService.ingest(eq("source-1"), any()))
                .thenThrow(new WebhookRequestHeadersTooLargeException("请求头过长"));

        mockMvc.perform(post("/api/event-sources/source-1/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().is(431))
                .andExpect(jsonPath("$.status").value(431));
    }

    @Test
    void webhookRouteReturnsCustomResponseWhenConfigured() throws Exception {
        when(apiAccessTokenRepository.count()).thenReturn(1L);
        when(eventIngestionApplicationService.ingest(eq("source-1"), any())).thenReturn(new EventIngestionResult()
                .setEventRecord(new EventRecord()
                        .setId("event-1")
                        .setSourceId("source-1")
                        .setSourceKey("source-key")
                        .setStatus(EventRecordStatus.DISPATCHED)
                        .setCreatedAt(LocalDateTime.now()))
                .setWebhookResponse(new EventWebhookResponsePayload()
                        .setStatus(202)
                        .setHeaders(java.util.Map.of("X-Ack", "ok"))
                        .setBody(java.util.Map.of("accepted", true))));

        mockMvc.perform(post("/api/event-sources/source-1/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.accepted").value(true))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().string("X-Ack", "ok"));
    }
}
