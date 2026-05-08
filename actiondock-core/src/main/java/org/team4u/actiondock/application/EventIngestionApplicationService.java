package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventDispatchStatus;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceWebhookErrorResponse;
import org.team4u.actiondock.domain.model.EventSourceWebhookResponse;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventTriggerDispatchResult;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.SchemaValueCopier;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.EventWebhookResponsePayload;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ProcessorEngine;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public class EventIngestionApplicationService {
    private static final int MAX_HEADER_COUNT = 64;
    private static final int MAX_HEADER_VALUE_BYTES = 8 * 1024;
    private static final int MAX_BODY_BYTES = 1024 * 1024;
    private static final String REDACTED = "[REDACTED]";

    private final EventSourceApplicationService eventSourceApplicationService;
    private final EventTriggerApplicationService eventTriggerApplicationService;
    private final EventRecordRepository eventRecordRepository;
    private final WebhookAuthenticator authenticator;
    private final JsonCodec jsonCodec;
    private final ProcessorEngine processorEngine;

    public EventIngestionApplicationService(EventSourceApplicationService eventSourceApplicationService,
                                            EventTriggerApplicationService eventTriggerApplicationService,
                                            EventRecordRepository eventRecordRepository,
                                            ConfigValueApplicationService configValueApplicationService,
                                            JsonCodec jsonCodec,
                                            ProcessorEngine processorEngine) {
        this.eventSourceApplicationService = eventSourceApplicationService;
        this.eventTriggerApplicationService = eventTriggerApplicationService;
        this.eventRecordRepository = eventRecordRepository;
        this.authenticator = new WebhookAuthenticator(configValueApplicationService);
        this.jsonCodec = jsonCodec;
        this.processorEngine = processorEngine;
    }

    public EventIngestionResult ingest(String sourceId, IncomingEventPayload payload) {
        EventSourceDefinition source = eventSourceApplicationService.get(sourceId);
        if (!source.isEnabled()) {
            throw new IllegalArgumentException("事件源已停用: " + sourceId);
        }
        IncomingEventPayload safePayload = payload == null ? new IncomingEventPayload() : payload;
        validatePayloadShape(safePayload);
        verifyContentType(source, safePayload);
        verifyAuth(source, safePayload);

        EventRecord record = normalizeEventRecord(source, safePayload);
        return dispatchTriggers(source, record, record.getNormalizedEvent());
    }

    private EventRecord normalizeEventRecord(EventSourceDefinition source, IncomingEventPayload safePayload) {
        Map<String, Object> rawHeaders = safePayload.getHeaders();
        Map<String, Object> rawQuery = safePayload.getQuery();
        Map<String, Object> rawBody = parseBody(safePayload.getRawBody());
        IncomingEventPayload materializedPayload = new IncomingEventPayload()
                .setHeaders(rawHeaders)
                .setQuery(rawQuery)
                .setBody(rawBody)
                .setRawBody(safePayload.getRawBody())
                .setContentType(safePayload.getContentType());
        EventRecord record = eventRecordRepository.save(new EventRecord()
                .setId(UUID.randomUUID().toString())
                .setSourceId(source.getId())
                .setSourceKey(source.getKey())
                .setStatus(EventRecordStatus.RECEIVED)
                .setRawHeaders(sanitizeForStorage(source, rawHeaders))
                .setRawQuery(sanitizeForStorage(source, rawQuery))
                .setRawBody(rawBody)
                .setCreatedAt(LocalDateTime.now()));

        NormalizedEvent event = eventSourceApplicationService.normalize(source, materializedPayload, record.getId());
        record.setNormalizedEvent(event)
                .setEventType(event.getEventType())
                .setEventId(event.getEventId())
                .setActor(event.getActor())
                .setSubject(event.getSubject())
                .setStatus(EventRecordStatus.NORMALIZED);
        return eventRecordRepository.save(record);
    }

    private EventIngestionResult dispatchTriggers(EventSourceDefinition source, EventRecord record, NormalizedEvent event) {
        List<EventTrigger> triggers = eventTriggerApplicationService.list().stream()
                .filter(EventTrigger::isEnabled)
                .filter(trigger -> trigger.getSourceId().equals(source.getId()))
                .toList();
        if (triggers.isEmpty()) {
            record.setStatus(EventRecordStatus.IGNORED);
            record = eventRecordRepository.save(record);
            EventIngestionResult result = new EventIngestionResult()
                    .setEventRecord(record)
                    .setDispatches(List.of())
                    .setSyncExecutions(List.of());
            buildWebhookResponse(source, event, List.of(), List.of(), Map.of())
                    .ifPresent(result::setWebhookResponse);
            return result;
        }

        List<EventDispatchRecord> dispatches = new ArrayList<>();
        List<ExecutionRecord> syncExecutions = new ArrayList<>();
        Map<String, ScriptDefinition> scriptsByExecutionId = new LinkedHashMap<>();
        for (EventTrigger trigger : triggers) {
            EventTriggerDispatchResult result = eventTriggerApplicationService.dispatch(source, trigger, record.getId(), event);
            dispatches.add(result.dispatch());
            if (result.execution() != null && trigger.getSubmitMode() == org.team4u.actiondock.domain.model.SubmitMode.SYNC) {
                syncExecutions.add(result.execution());
                if (result.scriptDefinition() != null) {
                    scriptsByExecutionId.put(result.execution().getId(), result.scriptDefinition());
                }
            }
        }
        record.setStatus(resolveRecordStatus(dispatches));
        record = eventRecordRepository.save(record);

        eventSourceApplicationService.markReceived(source.getId(), LocalDateTime.now());
        EventIngestionResult result = new EventIngestionResult()
                .setEventRecord(record)
                .setDispatches(dispatches)
                .setSyncExecutions(syncExecutions);
        buildWebhookResponse(source, event, dispatches, syncExecutions, scriptsByExecutionId)
                .ifPresent(result::setWebhookResponse);
        return result;
    }

    private static void validatePayloadShape(IncomingEventPayload payload) {
        Map<String, Object> headers = payload.getHeaders();
        if (headers.size() > MAX_HEADER_COUNT) {
            throw new WebhookRequestHeadersTooLargeException("请求头数量超过限制: " + headers.size() + " > " + MAX_HEADER_COUNT);
        }
        headers.forEach((name, value) -> {
            String text = ObjectValues.stringValue(value);
            if (text != null && text.getBytes(StandardCharsets.UTF_8).length > MAX_HEADER_VALUE_BYTES) {
                throw new WebhookRequestHeadersTooLargeException("请求头过长: " + name);
            }
        });
        String rawBody = payload.getRawBody();
        if (rawBody != null && rawBody.getBytes(StandardCharsets.UTF_8).length > MAX_BODY_BYTES) {
            throw new WebhookRequestPayloadTooLargeException("请求体过大: " + rawBody.getBytes(StandardCharsets.UTF_8).length + " > " + MAX_BODY_BYTES);
        }
    }

    private static void verifyContentType(EventSourceDefinition source, IncomingEventPayload payload) {
        String contentType = payload.getContentType();
        if (contentType == null || contentType.isBlank()) {
            return;
        }
        List<String> contentTypes = source.getTransport().getContentTypes();
        if (contentTypes.isEmpty()) {
            return;
        }
        boolean matched = contentTypes.stream().anyMatch(contentType::startsWith);
        if (!matched) {
            throw new IllegalArgumentException("不支持的 Content-Type: " + contentType);
        }
    }

    private void verifyAuth(EventSourceDefinition source, IncomingEventPayload payload) {
        try {
            authenticator.verify(source, payload);
        } catch (EventAuthenticationException exception) {
            eventRecordRepository.save(new EventRecord()
                    .setId(UUID.randomUUID().toString())
                    .setSourceId(source.getId())
                    .setSourceKey(source.getKey())
                    .setStatus(EventRecordStatus.AUTH_FAILED)
                    .setErrorMessage("事件鉴权失败")
                    .setCreatedAt(LocalDateTime.now()));
            throw exception;
        }
    }

    /**
     * 对请求参数进行脱敏处理，将鉴权相关的敏感值替换为占位符。
     *
     * @param source 事件源定义，包含鉴权配置
     * @param values 待脱敏的请求参数（headers 或 query）
     * @return 脱敏后的参数副本
     */
    private static Map<String, Object> sanitizeForStorage(EventSourceDefinition source, Map<String, Object> values) {
        Map<String, Object> sanitized = new LinkedHashMap<>(values);
        EventSourceAuthConfig auth = source.getAuth();
        if (auth == null || auth.getMode() == null) {
            return sanitized;
        }
        switch (auth.getMode()) {
            case HEADER_TOKEN -> redactValue(sanitized, auth.getTokenHeader());
            case QUERY_TOKEN -> redactValue(sanitized, auth.getTokenQueryParam());
            case HMAC_SHA256 -> redactValue(sanitized, auth.getSignatureHeader());
            default -> {
            }
        }
        return sanitized;
    }

    private static void redactValue(Map<String, Object> values, String key) {
        if (key == null || key.isBlank() || values.isEmpty()) {
            return;
        }
        if (values.containsKey(key)) {
            values.put(key, REDACTED);
            return;
        }
        for (String existingKey : new ArrayList<>(values.keySet())) {
            if (existingKey != null && existingKey.equalsIgnoreCase(key)) {
                values.put(existingKey, REDACTED);
                return;
            }
        }
    }

    private Map<String, Object> parseBody(String rawBody) {
        if (rawBody == null || rawBody.isBlank()) {
            return Map.of();
        }
        try {
            return jsonCodec.readMap(rawBody);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("请求体必须是 JSON 对象", exception);
        }
    }

    private static EventRecordStatus resolveRecordStatus(List<EventDispatchRecord> dispatches) {
        if (dispatches.isEmpty()) {
            return EventRecordStatus.IGNORED;
        }
        if (dispatches.stream().anyMatch(dispatch -> dispatch.getStatus() == EventDispatchStatus.EXECUTION_CREATED)) {
            return EventRecordStatus.DISPATCHED;
        }
        if (dispatches.stream().allMatch(dispatch -> dispatch.getStatus() == EventDispatchStatus.DUPLICATE)) {
            return EventRecordStatus.DUPLICATE;
        }
        if (dispatches.stream().allMatch(dispatch -> dispatch.getStatus() == EventDispatchStatus.FILTERED_OUT)) {
            return EventRecordStatus.IGNORED;
        }
        return EventRecordStatus.FAILED;
    }

    private java.util.Optional<EventWebhookResponsePayload> buildWebhookResponse(EventSourceDefinition source,
                                                                                 NormalizedEvent event,
                                                                                 List<EventDispatchRecord> dispatches,
                                                                                 List<ExecutionRecord> syncExecutions,
                                                                                 Map<String, ScriptDefinition> scriptsByExecutionId) {
        EventSourceWebhookResponse config = source.getWebhookResponse();
        if (config == null || config.isEmpty()) {
            return java.util.Optional.empty();
        }
        EventSourceWebhookErrorResponse errorResponse = config.getErrorResponse();
        try {
            ProcessorDefinition processor = ApplicationServiceSupport.normalizeProcessor(config.getResponseProcessor());
            if (processor == null) {
                return java.util.Optional.of(errorPayload(errorResponse));
            }
            ProcessorResult result = processorEngine.process(processor, buildResponseContext(source, event, dispatches, syncExecutions, scriptsByExecutionId));
            Map<String, Object> output = result.getOutput();
            if (!result.isSuccess() || output == null || output.isEmpty()) {
                return java.util.Optional.of(errorPayload(errorResponse));
            }
            return java.util.Optional.of(new EventWebhookResponsePayload()
                    .setStatus(config.getSuccessStatus())
                    .setHeaders(toStringHeaders(config.getSuccessHeaders()))
                    .setBody(output));
        } catch (RuntimeException exception) {
            return java.util.Optional.of(errorPayload(errorResponse));
        }
    }

    private ProcessorContext buildResponseContext(EventSourceDefinition source,
                                                  NormalizedEvent event,
                                                  List<EventDispatchRecord> dispatches,
                                                  List<ExecutionRecord> syncExecutions,
                                                  Map<String, ScriptDefinition> scriptsByExecutionId) {
        return new ProcessorContext()
                .setEvent(ApplicationServiceSupport.toEventMap(event))
                .setHeaders(event.getHeaders())
                .setQuery(event.getQuery())
                .setBody(event.getBody())
                .setSource(ApplicationServiceSupport.toSourceMap(source))
                .setVariables(Map.of(
                        "dispatches", dispatches.stream().map(this::toDispatchValue).toList(),
                        "executions", syncExecutions.stream()
                .map(execution -> toExecutionValue(execution, scriptsByExecutionId.get(execution.getId())))
                                .toList()
                ));
    }

    private Map<String, Object> toDispatchValue(EventDispatchRecord dispatch) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", dispatch.getId());
        value.put("eventId", dispatch.getEventId());
        value.put("sourceId", dispatch.getSourceId());
        value.put("triggerId", dispatch.getTriggerId());
        value.put("targetScriptId", dispatch.getTargetScriptId());
        value.put("status", dispatch.getStatus() == null ? null : dispatch.getStatus().name());
        value.put("filterMatched", dispatch.getFilterMatched());
        value.put("idempotencyKey", dispatch.getIdempotencyKey());
        value.put("mappedInput", dispatch.getMappedInput());
        value.put("executionId", dispatch.getExecutionId());
        value.put("executionStatus", dispatch.getExecutionStatus() == null ? null : dispatch.getExecutionStatus().name());
        value.put("errorMessage", dispatch.getErrorMessage());
        value.put("createdAt", dispatch.getCreatedAt() == null ? null : dispatch.getCreatedAt().toString());
        value.put("updatedAt", dispatch.getUpdatedAt() == null ? null : dispatch.getUpdatedAt().toString());
        return value;
    }

    private Map<String, Object> toExecutionValue(ExecutionRecord execution, ScriptDefinition scriptDefinition) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("executionId", execution.getId());
        value.put("triggerId", execution.getEventTriggerId());
        value.put("scriptId", execution.getScriptId());
        value.put("status", execution.getStatus() == null ? null : execution.getStatus().name());
        value.put("submitMode", execution.getSubmitMode() == null ? null : execution.getSubmitMode().name());
        value.put("input", execution.getInput());
        value.put("output", scriptDefinition == null
                ? new LinkedHashMap<>(execution.getOutput())
                : ExecutionOutputProjector.project(execution.getOutput(), scriptDefinition.getOutputSchema()));
        value.put("rawOutput", execution.getOutput());
        value.put("errorMessage", execution.getErrorMessage());
        value.put("logs", execution.getLogs().stream()
                .map(log -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("level", log.getLevel() == null ? null : log.getLevel().name());
                    item.put("message", log.getMessage());
                    item.put("timestamp", log.getCreatedAt() == null ? null : log.getCreatedAt().toString());
                    return item;
                })
                .collect(Collectors.toList()));
        value.put("createdAt", execution.getCreatedAt() == null ? null : execution.getCreatedAt().toString());
        value.put("startedAt", execution.getStartedAt() == null ? null : execution.getStartedAt().toString());
        value.put("finishedAt", execution.getFinishedAt() == null ? null : execution.getFinishedAt().toString());
        return value;
    }

    private static Map<String, String> toStringHeaders(Map<String, Object> headers) {
        Map<String, String> values = new LinkedHashMap<>();
        headers.forEach((name, value) -> {
            String stringValue = ObjectValues.stringValue(value);
            if (name != null && !name.isBlank() && stringValue != null) {
                values.put(name, stringValue);
            }
        });
        return values;
    }

    private static EventWebhookResponsePayload errorPayload(EventSourceWebhookErrorResponse errorResponse) {
        EventSourceWebhookErrorResponse effective = errorResponse == null
                ? new EventSourceWebhookErrorResponse()
                : errorResponse;
        return new EventWebhookResponsePayload()
                .setStatus(effective.getHttpStatus())
                .setBody(Map.of(
                        "status", effective.getHttpStatus(),
                        "msg", effective.getMsg(),
                        "data", SchemaValueCopier.copyObject(effective.getData())
                ));
    }
}
