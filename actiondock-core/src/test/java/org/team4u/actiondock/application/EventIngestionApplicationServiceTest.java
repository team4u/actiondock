package org.team4u.actiondock.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceAuthMode;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceTransport;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.JsonCodec;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

class EventIngestionApplicationServiceTest {
    private final InMemoryEventRecordRepository eventRecordRepository = new InMemoryEventRecordRepository();
    private final InMemoryConfigValueRepository configValueRepository = new InMemoryConfigValueRepository();
    private final ConfigValueApplicationService configValueApplicationService = new ConfigValueApplicationService(configValueRepository);
    private final EventSourceApplicationService eventSourceApplicationService = mock(EventSourceApplicationService.class);
    private final EventTriggerApplicationService eventTriggerApplicationService = mock(EventTriggerApplicationService.class);
    private final EventIngestionApplicationService service = new EventIngestionApplicationService(
            eventSourceApplicationService,
            eventTriggerApplicationService,
            eventRecordRepository,
            configValueApplicationService,
            new JacksonJsonCodec(new ObjectMapper())
    );

    @Test
    void authFailureStoresOnlyMinimalMetadata() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);

        assertThatThrownBy(() -> service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "wrong"))
                .setRawBody("{\"event\":\"created\"}")
                .setContentType("application/json")))
                .isInstanceOf(EventAuthenticationException.class);

        assertThat(eventRecordRepository.savedRecords()).hasSize(1);
        EventRecord record = eventRecordRepository.savedRecords().getFirst();
        assertThat(record.getStatus()).isEqualTo(EventRecordStatus.AUTH_FAILED);
        assertThat(record.getSourceId()).isEqualTo("source-1");
        assertThat(record.getSourceKey()).isEqualTo("source-key");
        assertThat(record.getRawHeaders()).isEmpty();
        assertThat(record.getRawQuery()).isEmpty();
        assertThat(record.getRawBody()).isEmpty();
        assertThat(record.getErrorMessage()).isEqualTo("事件鉴权失败");
        verify(eventSourceApplicationService, never()).normalize(any(), any(), any());
        verify(eventTriggerApplicationService, never()).list();
    }

    @Test
    void invalidJsonIsRejectedOnlyAfterAuthPasses() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);

        assertThatThrownBy(() -> service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "topsecret"))
                .setRawBody("not-json")
                .setContentType("application/json")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("请求体必须是 JSON 对象");

        assertThat(eventRecordRepository.savedRecords()).isEmpty();
        verify(eventSourceApplicationService, never()).normalize(any(), any(), any());
        verify(eventTriggerApplicationService, never()).list();
    }

    @Test
    void hmacAuthPersistsRedactedRequestAfterSuccessfulVerification() {
        String rawBody = "{\"event\":\"created\",\"nested\":{\"x\":1}}";
        EventSourceDefinition source = hmacSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        when(eventSourceApplicationService.normalize(eq(source), any(), anyString())).thenAnswer(invocation -> {
            IncomingEventPayload payload = invocation.getArgument(1);
            assertThat(payload.getRawBody()).isEqualTo(rawBody);
            assertThat(payload.getBody()).containsEntry("event", "created");
            return new NormalizedEvent()
                    .setEventType("created")
                    .setEventId("evt-1")
                    .setActor("bot")
                    .setSubject("demo");
        });
        when(eventTriggerApplicationService.list()).thenReturn(List.of());

        EventIngestionResult result = service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Signature", "sha256=" + sign(rawBody, "topsecret")))
                .setRawBody(rawBody)
                .setContentType("application/json"));

        assertThat(result.getEventRecord().getStatus()).isEqualTo(EventRecordStatus.IGNORED);
        assertThat(eventRecordRepository.savedRecords()).hasSize(3);
        EventRecord record = eventRecordRepository.savedRecords().getLast();
        assertThat(record.getRawHeaders()).containsEntry("X-Signature", "[REDACTED]");
        assertThat(record.getRawBody()).containsEntry("event", "created");
        assertThat(record.getRawBody().get("nested")).isInstanceOf(Map.class);
        verify(eventSourceApplicationService).normalize(eq(source), any(), anyString());
        verify(eventTriggerApplicationService).list();
        verify(eventTriggerApplicationService, never()).dispatch(any(), any(), any(), any());
    }

    @Test
    void oversizedBodyIsRejectedBeforePersisting() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        String oversizedBody = "{" + "\"data\":\"" + "a".repeat(1024 * 1024) + "\"}";

        assertThatThrownBy(() -> service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "secret"))
                .setRawBody(oversizedBody)
                .setContentType("application/json")))
                .isInstanceOf(WebhookRequestPayloadTooLargeException.class);

        assertThat(eventRecordRepository.savedRecords()).isEmpty();
        verify(eventSourceApplicationService, never()).normalize(any(), any(), any());
    }

    @Test
    void oversizedHeaderCountIsRejectedBeforePersisting() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        Map<String, Object> headers = new LinkedHashMap<>();
        for (int i = 0; i < 65; i++) {
            headers.put("X-Test-" + i, "value-" + i);
        }

        assertThatThrownBy(() -> service.ingest("source-1", payload()
                .setHeaders(headers)
                .setRawBody("{\"event\":\"created\"}")
                .setContentType("application/json")))
                .isInstanceOf(WebhookRequestHeadersTooLargeException.class);

        assertThat(eventRecordRepository.savedRecords()).isEmpty();
    }

    @Test
    void oversizedHeaderValueIsRejectedBeforePersisting() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);

        assertThatThrownBy(() -> service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "a".repeat(8 * 1024 + 1)))
                .setRawBody("{\"event\":\"created\"}")
                .setContentType("application/json")))
                .isInstanceOf(WebhookRequestHeadersTooLargeException.class);

        assertThat(eventRecordRepository.savedRecords()).isEmpty();
    }

    private EventSourceDefinition headerTokenSource() {
        configValueRepository.put("webhook.secret", "topsecret");
        return new EventSourceDefinition()
                .setId("source-1")
                .setKey("source-key")
                .setEnabled(true)
                .setTransport(new EventSourceTransport()
                        .setContentTypes(List.of("application/json")))
                .setAuth(new EventSourceAuthConfig()
                        .setMode(EventSourceAuthMode.HEADER_TOKEN)
                        .setTokenHeader("X-Webhook-Token")
                        .setSecretConfigKey("webhook.secret"));
    }

    private EventSourceDefinition hmacSource() {
        configValueRepository.put("webhook.secret", "topsecret");
        return new EventSourceDefinition()
                .setId("source-1")
                .setKey("source-key")
                .setEnabled(true)
                .setTransport(new EventSourceTransport()
                        .setContentTypes(List.of("application/json")))
                .setAuth(new EventSourceAuthConfig()
                        .setMode(EventSourceAuthMode.HMAC_SHA256)
                        .setSignatureHeader("X-Signature")
                        .setSignaturePrefix("sha256=")
                        .setSignaturePayload("RAW_BODY")
                        .setSecretConfigKey("webhook.secret"));
    }

    private IncomingEventPayload payload() {
        return new IncomingEventPayload();
    }

    private String sign(String payload, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static final class JacksonJsonCodec implements JsonCodec {
        private final ObjectMapper objectMapper;

        private JacksonJsonCodec(ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        public String write(Object value) {
            try {
                return value == null ? null : objectMapper.writeValueAsString(value);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            try {
                return json == null || json.isBlank() ? null : objectMapper.readValue(json, type);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public Object readUntyped(String json) {
            try {
                return json == null || json.isBlank() ? null : objectMapper.readValue(json, Object.class);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Map<String, Object> readMap(String json) {
            try {
                return json == null || json.isBlank() ? Map.of() : objectMapper.readValue(json, Map.class);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }
    }

    private static final class InMemoryConfigValueRepository implements ConfigValueRepository {
        private final Map<String, ConfigValue> values = new LinkedHashMap<>();

        @Override
        public ConfigValue save(ConfigValue configValue) {
            values.put(configValue.getKey(), copy(configValue));
            return copy(configValue);
        }

        @Override
        public Optional<ConfigValue> findByKey(String key) {
            return Optional.ofNullable(values.get(key)).map(InMemoryConfigValueRepository::copy);
        }

        @Override
        public List<ConfigValue> findAll() {
            return values.values().stream().map(InMemoryConfigValueRepository::copy).toList();
        }

        @Override
        public void deleteByKey(String key) {
            values.remove(key);
        }

        void put(String key, String value) {
            values.put(key, new ConfigValue().setKey(key).setValue(value));
        }

        private static ConfigValue copy(ConfigValue source) {
            return new ConfigValue()
                    .setKey(source.getKey())
                    .setValue(source.getValue())
                    .setDescription(source.getDescription())
                    .setSecret(source.isSecret())
                    .setRepositoryId(source.getRepositoryId())
                    .setRepositoryToolId(source.getRepositoryToolId())
                    .setRepositoryVersion(source.getRepositoryVersion())
                    .setPublishMode(source.getPublishMode())
                    .setManaged(source.isManaged())
                    .setOverridden(source.isOverridden())
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt());
        }
    }

    private static final class InMemoryEventRecordRepository implements EventRecordRepository {
        private final Map<String, EventRecord> storage = new LinkedHashMap<>();
        private final List<EventRecord> savedRecords = new ArrayList<>();

        @Override
        public EventRecord save(EventRecord record) {
            EventRecord copy = copy(record);
            storage.put(copy.getId(), copy);
            savedRecords.add(copy(copy));
            return copy(copy);
        }

        @Override
        public Optional<EventRecord> findById(String id) {
            return Optional.ofNullable(storage.get(id)).map(InMemoryEventRecordRepository::copy);
        }

        @Override
        public List<EventRecord> findAll() {
            return storage.values().stream().map(InMemoryEventRecordRepository::copy).toList();
        }

        @Override
        public List<EventRecord> findBySourceId(String sourceId) {
            return storage.values().stream()
                    .filter(record -> sourceId.equals(record.getSourceId()))
                    .map(InMemoryEventRecordRepository::copy)
                    .toList();
        }

        List<EventRecord> savedRecords() {
            return List.copyOf(savedRecords);
        }

        private static EventRecord copy(EventRecord source) {
            EventRecord record = new EventRecord()
                    .setId(source.getId())
                    .setSourceId(source.getSourceId())
                    .setSourceKey(source.getSourceKey())
                    .setStatus(source.getStatus())
                    .setEventType(source.getEventType())
                    .setEventId(source.getEventId())
                    .setActor(source.getActor())
                    .setSubject(source.getSubject())
                    .setRawHeaders(source.getRawHeaders())
                    .setRawQuery(source.getRawQuery())
                    .setRawBody(source.getRawBody())
                    .setNormalizedEvent(source.getNormalizedEvent())
                    .setErrorMessage(source.getErrorMessage())
                    .setCreatedAt(source.getCreatedAt());
            return record;
        }
    }
}
