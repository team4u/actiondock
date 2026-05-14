package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookResponsePayload;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionSubmissionMetadata;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.SubmitMode;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class WebhookExecutionApplicationService {
    private final WebhookApplicationService webhookApplicationService;
    private final ExecutionApplicationService executionApplicationService;

    public WebhookExecutionApplicationService(WebhookApplicationService webhookApplicationService,
                                              ExecutionApplicationService executionApplicationService) {
        this.webhookApplicationService = webhookApplicationService;
        this.executionApplicationService = executionApplicationService;
    }

    public WebhookExecutionResult ingest(String webhookId, WebhookRequest request) {
        WebhookDefinition webhook = webhookApplicationService.get(webhookId);
        ensureEnabled(webhook);
        WebhookRequest safeRequest = request == null ? new WebhookRequest() : request;
        Map<String, Object> input = buildInput(webhook, safeRequest);
        ExecutionRecord execution = executionApplicationService.executePublished(
                webhook.getWebhookScriptId(),
                input,
                SubmitMode.SYNC,
                new ExecutionSubmissionMetadata()
                        .setTriggerSource(ExecutionTriggerSource.WEBHOOK)
                        .setWebhookId(webhook.getId())
        );
        WebhookResponsePayload response = toWebhookResponse(execution);
        webhookApplicationService.markReceived(webhook.getId(), LocalDateTime.now());
        return new WebhookExecutionResult()
                .setRequest(input)
                .setExecution(execution)
                .setWebhookResponse(response);
    }

    public WebhookExecutionResult test(String webhookId, WebhookRequest request) {
        WebhookDefinition webhook = webhookApplicationService.get(webhookId);
        WebhookRequest safeRequest = request == null ? new WebhookRequest() : request;
        Map<String, Object> input = buildInput(webhook, safeRequest);
        ExecutionRecord execution = executionApplicationService.executePublished(
                webhook.getWebhookScriptId(),
                input,
                SubmitMode.SYNC,
                new ExecutionSubmissionMetadata()
                        .setTriggerSource(ExecutionTriggerSource.WEBHOOK)
                        .setWebhookId(webhook.getId())
        );
        return new WebhookExecutionResult()
                .setRequest(input)
                .setExecution(execution)
                .setWebhookResponse(toWebhookResponse(execution));
    }

    private static void ensureEnabled(WebhookDefinition webhook) {
        if (!webhook.isEnabled()) {
            throw new IllegalArgumentException("Webhook 已停用: " + webhook.getId());
        }
    }

    private static Map<String, Object> buildInput(WebhookDefinition webhook, WebhookRequest request) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("request", request.toInputMap());
        input.put("webhook", Map.of(
                "id", webhook.getId(),
                "key", webhook.getKey(),
                "name", webhook.getName()
        ));
        return input;
    }

    private static WebhookResponsePayload toWebhookResponse(ExecutionRecord execution) {
        if (execution == null) {
            throw new IllegalStateException("Webhook 脚本未返回执行结果");
        }
        if (execution.getStatus() != org.team4u.actiondock.domain.model.ExecutionStatus.SUCCESS) {
            String message = execution.getErrorMessage() == null ? "Webhook 脚本执行失败" : execution.getErrorMessage();
            throw new IllegalStateException(message);
        }
        Map<String, Object> output = execution.getOutput();
        Object statusValue = output.get("status");
        if (!(statusValue instanceof Number statusNumber)) {
            throw new IllegalStateException("Webhook 脚本必须返回数字 status");
        }
        int status = statusNumber.intValue();
        if (status < 100 || status > 999) {
            throw new IllegalStateException("Webhook 脚本返回了非法 status: " + status);
        }
        Map<String, List<String>> headers = normalizeHeaders(output.get("headers"), output.get("body"));
        return new WebhookResponsePayload()
                .setStatus(status)
                .setHeaders(headers)
                .setBody(output.get("body"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, List<String>> normalizeHeaders(Object value, Object body) {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> map) {
            map.forEach((key, headerValue) -> headers.put(String.valueOf(key), normalizeHeaderValues(headerValue)));
        }
        if (headers.keySet().stream().noneMatch(name -> "content-type".equalsIgnoreCase(name))) {
            if (body instanceof String) {
                headers.put("Content-Type", List.of("text/plain;charset=UTF-8"));
            } else if (body != null) {
                headers.put("Content-Type", List.of("application/json;charset=UTF-8"));
            }
        }
        return headers;
    }

    private static List<String> normalizeHeaderValues(Object value) {
        if (value == null) {
            return List.of();
        }
        if (value instanceof List<?> list) {
            List<String> values = new ArrayList<>();
            for (Object item : list) {
                if (item != null) {
                    values.add(String.valueOf(item));
                }
            }
            return List.copyOf(values);
        }
        return List.of(String.valueOf(value));
    }
}
