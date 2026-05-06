package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventDispatchStatus;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.JsonCodec;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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

    public EventIngestionApplicationService(EventSourceApplicationService eventSourceApplicationService,
                                            EventTriggerApplicationService eventTriggerApplicationService,
                                            EventRecordRepository eventRecordRepository,
                                            ConfigValueApplicationService configValueApplicationService,
                                            JsonCodec jsonCodec) {
        this.eventSourceApplicationService = eventSourceApplicationService;
        this.eventTriggerApplicationService = eventTriggerApplicationService;
        this.eventRecordRepository = eventRecordRepository;
        this.authenticator = new WebhookAuthenticator(configValueApplicationService);
        this.jsonCodec = jsonCodec;
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
            return new EventIngestionResult().setEventRecord(record).setDispatches(List.of());
        }

        List<EventDispatchRecord> dispatches = new ArrayList<>();
        for (EventTrigger trigger : triggers) {
            dispatches.add(eventTriggerApplicationService.dispatch(source, trigger, record.getId(), event));
        }
        record.setStatus(resolveRecordStatus(dispatches));
        record = eventRecordRepository.save(record);

        eventSourceApplicationService.markReceived(source.getId(), LocalDateTime.now());
        return new EventIngestionResult()
                .setEventRecord(record)
                .setDispatches(dispatches);
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
}
