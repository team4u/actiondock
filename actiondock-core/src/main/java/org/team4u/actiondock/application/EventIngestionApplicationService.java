package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventDispatchStatus;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceAuthMode;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.JsonCodec;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class EventIngestionApplicationService {
    private static final int MAX_HEADER_COUNT = 64;
    private static final int MAX_HEADER_VALUE_BYTES = 8 * 1024;
    private static final int MAX_BODY_BYTES = 1024 * 1024;
    private static final String REDACTED = "[REDACTED]";
    private static final String SIGNATURE_PAYLOAD_TIMESTAMP_DOT_RAW_BODY = "TIMESTAMP_DOT_RAW_BODY";
    private static final String HMAC_SHA256_ALGORITHM = "HmacSHA256";

    private final EventSourceApplicationService eventSourceApplicationService;
    private final EventTriggerApplicationService eventTriggerApplicationService;
    private final EventRecordRepository eventRecordRepository;
    private final ConfigValueApplicationService configValueApplicationService;
    private final JsonCodec jsonCodec;

    public EventIngestionApplicationService(EventSourceApplicationService eventSourceApplicationService,
                                            EventTriggerApplicationService eventTriggerApplicationService,
                                            EventRecordRepository eventRecordRepository,
                                            ConfigValueApplicationService configValueApplicationService,
                                            JsonCodec jsonCodec) {
        this.eventSourceApplicationService = eventSourceApplicationService;
        this.eventTriggerApplicationService = eventTriggerApplicationService;
        this.eventRecordRepository = eventRecordRepository;
        this.configValueApplicationService = configValueApplicationService;
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
        EventSourceAuthConfig auth = source.getAuth();
        if (auth == null || auth.getMode() == null || auth.getMode() == EventSourceAuthMode.NONE) {
            return;
        }
        boolean passed = switch (auth.getMode()) {
            case HEADER_TOKEN -> verifyHeaderToken(auth, payload);
            case QUERY_TOKEN -> verifyQueryToken(auth, payload);
            case HMAC_SHA256 -> verifyHmac(auth, payload);
            default -> true;
        };
        if (!passed) {
            eventRecordRepository.save(new EventRecord()
                    .setId(UUID.randomUUID().toString())
                    .setSourceId(source.getId())
                    .setSourceKey(source.getKey())
                    .setStatus(EventRecordStatus.AUTH_FAILED)
                    .setErrorMessage("事件鉴权失败")
                    .setCreatedAt(LocalDateTime.now()));
            throw new EventAuthenticationException("事件鉴权失败");
        }
    }

    private boolean verifyHeaderToken(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String provided = valueByName(payload.getHeaders(), auth.getTokenHeader());
        return verifyToken(provided, auth, "请求头");
    }

    private boolean verifyQueryToken(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String provided = ObjectValues.stringValue(payload.getQuery().get(auth.getTokenQueryParam()));
        return verifyToken(provided, auth, "查询参数");
    }

    private boolean verifyToken(String providedToken, EventSourceAuthConfig auth, String context) {
        String secret = resolveSecret(auth);
        return constantTimeEquals(secret, providedToken);
    }

    private boolean verifyHmac(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String secret = resolveSecret(auth);
        if (secret == null || secret.isBlank()) {
            return false;
        }
        String signature = valueByName(payload.getHeaders(), auth.getSignatureHeader());
        if (signature == null || signature.isBlank()) {
            return false;
        }
        String prefix = auth.getSignaturePrefix() == null ? "" : auth.getSignaturePrefix();
        if (!prefix.isEmpty() && !signature.startsWith(prefix)) {
            return false;
        }
        String actual = prefix.isEmpty() ? signature : signature.substring(prefix.length());
        String signingPayload = buildSigningPayload(auth, payload);
        return constantTimeEquals(hmacSha256Bytes(secret, signingPayload), actual);
    }

    private static String buildSigningPayload(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String rawBody = payload.getRawBody() == null ? "" : payload.getRawBody();
        if (!SIGNATURE_PAYLOAD_TIMESTAMP_DOT_RAW_BODY.equalsIgnoreCase(auth.getSignaturePayload())) {
            return rawBody;
        }
        String timestamp = valueByName(payload.getHeaders(), auth.getTimestampHeader());
        if (timestamp == null || !isTimestampWithinSkew(timestamp, auth.getMaxSkewSeconds())) {
            return "";
        }
        return timestamp + "." + rawBody;
    }

    private static boolean isTimestampWithinSkew(String timestamp, Integer maxSkewSeconds) {
        if (maxSkewSeconds == null || maxSkewSeconds <= 0) {
            return true;
        }
        try {
            long epoch = Long.parseLong(timestamp);
            Duration skew = Duration.between(Instant.ofEpochSecond(epoch), Instant.now());
            return Math.abs(skew.toSeconds()) <= maxSkewSeconds;
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    private static byte[] hmacSha256Bytes(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256_ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256_ALGORITHM));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            throw new IllegalStateException("HMAC 计算失败", exception);
        }
    }

    private String resolveSecret(EventSourceAuthConfig auth) {
        if (auth.getSecretConfigKey() == null || auth.getSecretConfigKey().isBlank()) {
            return null;
        }
        return configValueApplicationService.snapshot().get(auth.getSecretConfigKey());
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

    private static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        return constantTimeEquals(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean constantTimeEquals(byte[] expected, byte[] actual) {
        return MessageDigest.isEqual(expected, actual);
    }

    private static boolean constantTimeEquals(byte[] expected, String actualHex) {
        if (expected == null || actualHex == null || actualHex.isBlank()) {
            return false;
        }
        try {
            byte[] actual = HexFormat.of().parseHex(actualHex);
            return constantTimeEquals(expected, actual);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static String valueByName(Map<String, Object> values, String key) {
        if (values == null || values.isEmpty() || key == null || key.isBlank()) {
            return null;
        }
        Object exact = values.get(key);
        if (exact != null) {
            return ObjectValues.stringValue(exact);
        }
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(key)) {
                return ObjectValues.stringValue(entry.getValue());
            }
        }
        return null;
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
