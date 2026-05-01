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
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.EventRecordRepository;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class EventIngestionApplicationService {
    private final EventSourceApplicationService eventSourceApplicationService;
    private final EventTriggerApplicationService eventTriggerApplicationService;
    private final EventRecordRepository eventRecordRepository;
    private final EventDispatchRepository eventDispatchRepository;
    private final ConfigValueApplicationService configValueApplicationService;

    public EventIngestionApplicationService(EventSourceApplicationService eventSourceApplicationService,
                                            EventTriggerApplicationService eventTriggerApplicationService,
                                            EventRecordRepository eventRecordRepository,
                                            EventDispatchRepository eventDispatchRepository,
                                            ConfigValueApplicationService configValueApplicationService) {
        this.eventSourceApplicationService = eventSourceApplicationService;
        this.eventTriggerApplicationService = eventTriggerApplicationService;
        this.eventRecordRepository = eventRecordRepository;
        this.eventDispatchRepository = eventDispatchRepository;
        this.configValueApplicationService = configValueApplicationService;
    }

    public EventIngestionResult ingest(String sourceId, IncomingEventPayload payload) {
        EventSourceDefinition source = eventSourceApplicationService.get(sourceId);
        if (!source.isEnabled()) {
            throw new IllegalArgumentException("事件源已停用: " + sourceId);
        }
        IncomingEventPayload safePayload = payload == null ? new IncomingEventPayload() : payload;
        EventRecord record = eventRecordRepository.save(new EventRecord()
                .setId(UUID.randomUUID().toString())
                .setSourceId(source.getId())
                .setSourceKey(source.getKey())
                .setStatus(EventRecordStatus.RECEIVED)
                .setRawHeaders(safePayload.getHeaders())
                .setRawQuery(safePayload.getQuery())
                .setRawBody(safePayload.getBody())
                .setCreatedAt(LocalDateTime.now()));
        verifyContentType(source, safePayload);
        verifyAuth(source, safePayload, record);

        NormalizedEvent event = eventSourceApplicationService.normalize(source, safePayload, record.getId());
        record.setNormalizedEvent(event)
                .setEventType(event.getEventType())
                .setEventId(event.getEventId())
                .setActor(event.getActor())
                .setSubject(event.getSubject())
                .setStatus(EventRecordStatus.NORMALIZED);
        eventRecordRepository.save(record);

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

    private void verifyContentType(EventSourceDefinition source, IncomingEventPayload payload) {
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

    private void verifyAuth(EventSourceDefinition source, IncomingEventPayload payload, EventRecord record) {
        EventSourceAuthConfig auth = source.getAuth();
        if (auth == null || auth.getMode() == null || auth.getMode() == EventSourceAuthMode.NONE) {
            return;
        }
        boolean passed = switch (auth.getMode()) {
            case HEADER_TOKEN -> verifyHeaderToken(auth, payload);
            case QUERY_TOKEN -> verifyQueryToken(auth, payload);
            case HMAC_SHA256 -> verifyHmac(auth, payload);
            case NONE -> true;
        };
        if (!passed) {
            record.setStatus(EventRecordStatus.AUTH_FAILED)
                    .setErrorMessage("事件鉴权失败");
            eventRecordRepository.save(record);
            throw new EventAuthenticationException("事件鉴权失败");
        }
    }

    private boolean verifyHeaderToken(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String secret = resolveSecret(auth);
        String header = stringValue(payload.getHeaders().get(auth.getTokenHeader()));
        return secret != null && secret.equals(header);
    }

    private boolean verifyQueryToken(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String secret = resolveSecret(auth);
        String query = stringValue(payload.getQuery().get(auth.getTokenQueryParam()));
        return secret != null && secret.equals(query);
    }

    private boolean verifyHmac(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String secret = resolveSecret(auth);
        if (secret == null || secret.isBlank()) {
            return false;
        }
        String signature = stringValue(payload.getHeaders().get(auth.getSignatureHeader()));
        if (signature == null || signature.isBlank()) {
            return false;
        }
        String prefix = auth.getSignaturePrefix() == null ? "" : auth.getSignaturePrefix();
        if (!prefix.isEmpty() && !signature.startsWith(prefix)) {
            return false;
        }
        String actual = prefix.isEmpty() ? signature : signature.substring(prefix.length());
        String signingPayload = buildSigningPayload(auth, payload);
        String expected = hmacSha256Hex(secret, signingPayload);
        return expected.equalsIgnoreCase(actual);
    }

    private String buildSigningPayload(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String rawBody = payload.getRawBody() == null ? "" : payload.getRawBody();
        if ("TIMESTAMP_DOT_RAW_BODY".equalsIgnoreCase(auth.getSignaturePayload())) {
            String timestamp = stringValue(payload.getHeaders().get(auth.getTimestampHeader()));
            if (timestamp == null) {
                return "";
            }
            if (auth.getMaxSkewSeconds() != null && auth.getMaxSkewSeconds() > 0) {
                try {
                    long epoch = Long.parseLong(timestamp);
                    Duration skew = Duration.between(Instant.ofEpochSecond(epoch), Instant.now());
                    if (Math.abs(skew.toSeconds()) > auth.getMaxSkewSeconds()) {
                        return "";
                    }
                } catch (NumberFormatException exception) {
                    return "";
                }
            }
            return timestamp + "." + rawBody;
        }
        return rawBody;
    }

    private String hmacSha256Hex(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
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

    private EventRecordStatus resolveRecordStatus(List<EventDispatchRecord> dispatches) {
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

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
