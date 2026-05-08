package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class EventSourceWebhookResponse {
    private int successStatus = 200;
    private Map<String, Object> successHeaders = new LinkedHashMap<>();
    private ProcessorDefinition responseProcessor;
    private EventSourceWebhookErrorResponse errorResponse = new EventSourceWebhookErrorResponse();

    public int getSuccessStatus() {
        return successStatus;
    }

    public EventSourceWebhookResponse setSuccessStatus(int successStatus) {
        this.successStatus = successStatus <= 0 ? 200 : successStatus;
        return this;
    }

    public Map<String, Object> getSuccessHeaders() {
        return SchemaValueCopier.copyMap(successHeaders);
    }

    public EventSourceWebhookResponse setSuccessHeaders(Map<String, Object> successHeaders) {
        this.successHeaders = SchemaValueCopier.copyMap(successHeaders);
        return this;
    }

    public ProcessorDefinition getResponseProcessor() {
        return responseProcessor;
    }

    public EventSourceWebhookResponse setResponseProcessor(ProcessorDefinition responseProcessor) {
        this.responseProcessor = responseProcessor;
        return this;
    }

    public EventSourceWebhookErrorResponse getErrorResponse() {
        return errorResponse;
    }

    public EventSourceWebhookResponse setErrorResponse(EventSourceWebhookErrorResponse errorResponse) {
        this.errorResponse = errorResponse == null ? new EventSourceWebhookErrorResponse() : errorResponse;
        return this;
    }

    public boolean isEmpty() {
        boolean defaultSuccessStatus = successStatus == 200;
        boolean emptySuccessHeaders = successHeaders == null || successHeaders.isEmpty();
        boolean emptyProcessor = responseProcessor == null || responseProcessor.isEmpty();
        boolean emptyErrorResponse = errorResponse == null || errorResponse.isEmpty();
        return defaultSuccessStatus && emptySuccessHeaders && emptyProcessor && emptyErrorResponse;
    }
}
