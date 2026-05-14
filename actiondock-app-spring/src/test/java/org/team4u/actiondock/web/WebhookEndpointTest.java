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
import org.team4u.actiondock.application.WebhookRequestHeadersTooLargeException;
import org.team4u.actiondock.application.WebhookRequestPayloadTooLargeException;
import org.team4u.actiondock.application.WebhookExecutionApplicationService;
import org.team4u.actiondock.application.WebhookExecutionResult;
import org.team4u.actiondock.domain.model.WebhookResponsePayload;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
class WebhookEndpointTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WebhookExecutionApplicationService webhookExecutionApplicationService;

    @MockBean
    private ApiAccessTokenRepository apiAccessTokenRepository;

    @Test
    void webhookRouteBypassesGlobalApiKeyFilterAndPreservesRequestEnvelope() throws Exception {
        when(apiAccessTokenRepository.countEnabled()).thenReturn(1L);
        when(webhookExecutionApplicationService.ingest(eq("source-1"), any())).thenReturn(new WebhookExecutionResult()
                .setExecution(new ExecutionRecord()
                        .setId("execution-1")
                        .setStatus(ExecutionStatus.SUCCESS))
                .setWebhookResponse(new WebhookResponsePayload()
                        .setStatus(202)
                        .setHeaders(Map.of("X-Ack", List.of("ok")))
                        .setBody("accepted")));

        mockMvc.perform(post("/api/webhooks/source-1")
                        .queryParam("topic", "created", "updated")
                        .queryParam("tenant", "acme")
                        .header("X-Test", "a", "b")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("hello webhook"))
                .andExpect(status().isAccepted())
                .andExpect(header().string("X-Ack", "ok"))
                .andExpect(content().string("accepted"));

        verify(webhookExecutionApplicationService).ingest(eq("source-1"), argThat(request ->
                request != null
                        && "POST".equals(request.getMethod())
                        && "/api/webhooks/source-1".equals(request.getPath())
                        && List.of("a", "b").equals(request.getHeaders().get("X-Test"))
                        && List.of("created", "updated").equals(request.getQuery().get("topic"))
                        && List.of("acme").equals(request.getQuery().get("tenant"))
                        && "hello webhook".equals(request.getRawBody())
                        && MediaType.TEXT_PLAIN_VALUE.equals(request.getContentType())
        ));
    }

    @Test
    void webhookRouteReturnsJsonBodyFromControllerScript() throws Exception {
        when(apiAccessTokenRepository.countEnabled()).thenReturn(1L);
        when(webhookExecutionApplicationService.ingest(eq("source-1"), any())).thenReturn(new WebhookExecutionResult()
                .setExecution(new ExecutionRecord()
                        .setId("execution-2")
                        .setStatus(ExecutionStatus.SUCCESS))
                .setWebhookResponse(new WebhookResponsePayload()
                        .setStatus(200)
                        .setHeaders(Map.of("Content-Type", List.of("application/json;charset=UTF-8")))
                        .setBody(Map.of("accepted", true))));

        mockMvc.perform(post("/api/webhooks/source-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/json;charset=UTF-8"))
                .andExpect(jsonPath("$.accepted").value(true));
    }

    @Test
    void payloadTooLargeIsMappedTo413() throws Exception {
        when(apiAccessTokenRepository.countEnabled()).thenReturn(1L);
        when(webhookExecutionApplicationService.ingest(eq("source-1"), any()))
                .thenThrow(new WebhookRequestPayloadTooLargeException("请求体过大"));

        mockMvc.perform(post("/api/webhooks/source-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.status").value(413));
    }

    @Test
    void headersTooLargeIsMappedTo431() throws Exception {
        when(apiAccessTokenRepository.countEnabled()).thenReturn(1L);
        when(webhookExecutionApplicationService.ingest(eq("source-1"), any()))
                .thenThrow(new WebhookRequestHeadersTooLargeException("请求头过长"));

        mockMvc.perform(post("/api/webhooks/source-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hello\":\"world\"}"))
                .andExpect(status().is(431))
                .andExpect(jsonPath("$.status").value(431));
    }
}
