package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookResponsePayload;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ExecutionSubmissionMetadata;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.SubmitMode;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WebhookExecutionApplicationServiceTest {
    private final WebhookApplicationService webhookApplicationService = mock(WebhookApplicationService.class);
    private final ExecutionApplicationService executionApplicationService = mock(ExecutionApplicationService.class);
    private final WebhookExecutionApplicationService service = new WebhookExecutionApplicationService(
            webhookApplicationService,
            executionApplicationService
    );

    @Test
    void ingestExecutesPublishedWebhookScriptWithWebhookMetadata() {
        WebhookDefinition source = source();
        WebhookRequest request = new WebhookRequest()
                .setMethod("post")
                .setPath("/hook/demo")
                .setHeaders(Map.of("X-Test", List.of("a", "b")))
                .setQuery(Map.of("topic", List.of("created")))
                .setRawBody("{\"hello\":\"world\"}")
                .setContentType("application/json");
        ExecutionRecord execution = successExecution(Map.of(
                "status", 202,
                "headers", Map.of("X-Ack", List.of("ok", "done")),
                "body", Map.of("accepted", true)
        ));
        when(webhookApplicationService.get("source-1")).thenReturn(source);
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC), any()))
                .thenReturn(execution);

        WebhookExecutionResult result = service.ingest("source-1", request);

        assertThat(result.getExecution()).isSameAs(execution);
        assertThat(result.getRequest()).containsEntry("webhook", Map.of(
                "id", "source-1",
                "key", "source-key",
                "name", "Demo Webhook"
        ));
        assertThat(result.getWebhookResponse().getStatus()).isEqualTo(202);
        assertThat(result.getWebhookResponse().getHeaders()).containsEntry("X-Ack", List.of("ok", "done"));
        assertThat(result.getWebhookResponse().getBody()).isEqualTo(Map.of("accepted", true));

        ArgumentCaptor<Map<String, Object>> inputCaptor = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<ExecutionSubmissionMetadata> metadataCaptor = ArgumentCaptor.forClass(ExecutionSubmissionMetadata.class);
        verify(executionApplicationService).executePublished(eq("script-1"), inputCaptor.capture(), eq(SubmitMode.SYNC), metadataCaptor.capture());
        assertThat(inputCaptor.getValue()).containsEntry("webhook", Map.of(
                "id", "source-1",
                "key", "source-key",
                "name", "Demo Webhook"
        ));
        assertThat(inputCaptor.getValue()).containsEntry("request", Map.of(
                "method", "POST",
                "path", "/hook/demo",
                "headers", Map.of("X-Test", List.of("a", "b")),
                "query", Map.of("topic", List.of("created")),
                "rawBody", "{\"hello\":\"world\"}",
                "contentType", "application/json"
        ));
        assertThat(metadataCaptor.getValue().getTriggerSource()).isEqualTo(ExecutionTriggerSource.WEBHOOK);
        assertThat(metadataCaptor.getValue().getWebhookId()).isEqualTo("source-1");
        verify(webhookApplicationService).markReceived(eq("source-1"), any());
    }

    @Test
    void testDoesNotMarkSourceReceived() {
        when(webhookApplicationService.get("source-1")).thenReturn(source());
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC), any()))
                .thenReturn(successExecution(Map.of("status", 200, "body", "ok")));

        WebhookExecutionResult result = service.test("source-1", new WebhookRequest().setPath("/hook/demo"));

        assertThat(result.getWebhookResponse().getHeaders()).containsEntry("Content-Type", List.of("text/plain;charset=UTF-8"));
        verify(webhookApplicationService, never()).markReceived(any(), any());
    }

    @Test
    void objectBodyDefaultsToJsonContentType() {
        when(webhookApplicationService.get("source-1")).thenReturn(source());
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC), any()))
                .thenReturn(successExecution(Map.of(
                        "status", 200,
                        "body", Map.of("accepted", true)
                )));

        WebhookResponsePayload payload = service.test("source-1", new WebhookRequest()).getWebhookResponse();

        assertThat(payload.getHeaders()).containsEntry("Content-Type", List.of("application/json;charset=UTF-8"));
        assertThat(payload.getBody()).isEqualTo(Map.of("accepted", true));
    }

    @Test
    void missingStatusIsRejected() {
        when(webhookApplicationService.get("source-1")).thenReturn(source());
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC), any()))
                .thenReturn(successExecution(Map.of("body", "ok")));

        assertThatThrownBy(() -> service.test("source-1", new WebhookRequest()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Webhook 脚本必须返回数字 status");
    }

    @Test
    void failedExecutionIsRejected() {
        when(webhookApplicationService.get("source-1")).thenReturn(source());
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.SYNC), any()))
                .thenReturn(new ExecutionRecord()
                        .setId("execution-1")
                        .setStatus(ExecutionStatus.FAILED)
                        .setErrorMessage("boom"));

        assertThatThrownBy(() -> service.ingest("source-1", new WebhookRequest()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("boom");
    }

    private static WebhookDefinition source() {
        return new WebhookDefinition()
                .setId("source-1")
                .setKey("source-key")
                .setName("Demo Webhook")
                .setEnabled(true)
                .setWebhookScriptId("script-1");
    }

    private static ExecutionRecord successExecution(Map<String, Object> output) {
        return new ExecutionRecord()
                .setId("execution-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setOutput(new LinkedHashMap<>(output));
    }
}
