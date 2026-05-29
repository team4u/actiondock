package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.WebhookResponsePayload;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.SchemaValueCopier;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Webhook 执行结果，封装脚本执行后的完整响应信息。
 * <p>
 * 包含原始请求数据、执行记录以及 Webhook 响应负载，用于将脚本执行结果回传给调用方。
 *
 * @author jay.wu
 */
public class WebhookExecutionResult {
    private Map<String, Object> request = new LinkedHashMap<>();
    private ExecutionRecord execution;
    private WebhookResponsePayload webhookResponse;

    public Map<String, Object> getRequest() {
        return SchemaValueCopier.copyMap(request);
    }

    public WebhookExecutionResult setRequest(Map<String, Object> request) {
        this.request = SchemaValueCopier.copyMap(request);
        return this;
    }

    public ExecutionRecord getExecution() {
        return execution;
    }

    public WebhookExecutionResult setExecution(ExecutionRecord execution) {
        this.execution = execution;
        return this;
    }

    public WebhookResponsePayload getWebhookResponse() {
        return webhookResponse;
    }

    public WebhookExecutionResult setWebhookResponse(WebhookResponsePayload webhookResponse) {
        this.webhookResponse = webhookResponse;
        return this;
    }
}
