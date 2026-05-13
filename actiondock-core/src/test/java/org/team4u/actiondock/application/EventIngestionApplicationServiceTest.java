package org.team4u.actiondock.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventRecordStatus;
import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceAuthMode;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceTransport;
import org.team4u.actiondock.domain.model.EventSourceWebhookErrorResponse;
import org.team4u.actiondock.domain.model.EventSourceWebhookResponse;
import org.team4u.actiondock.domain.model.EventTriggerDispatchResult;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorMode;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.TemplateProcessorConfig;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ProcessorEngine;

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
    private final ProcessorEngine processorEngine = mock(ProcessorEngine.class);
    private final EventIngestionApplicationService service = new EventIngestionApplicationService(
            eventSourceApplicationService,
            eventTriggerApplicationService,
            eventRecordRepository,
            configValueApplicationService,
            new JacksonJsonCodec(new ObjectMapper()),
            processorEngine
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
        assertThat(record.getRawBody()).isEqualTo(Map.of());
        assertThat(record.getErrorMessage()).isEqualTo("事件鉴权失败");
        verify(eventSourceApplicationService, never()).normalize(any(), any(), any());
        verify(eventTriggerApplicationService, never()).list();
    }

    @Test
    void nonJsonStringBodyIsAcceptedAfterAuthPasses() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        when(eventSourceApplicationService.normalize(eq(source), any(), anyString())).thenAnswer(invocation -> {
            IncomingEventPayload payload = invocation.getArgument(1);
            assertThat(payload.getRawBody()).isEqualTo("not-json");
            assertThat(payload.getBody()).isEqualTo("not-json");
            return new NormalizedEvent()
                    .setEventType("text")
                    .setEventId("evt-text")
                    .setBody(payload.getBody())
                    .setRawBody(payload.getRawBody());
        });
        when(eventTriggerApplicationService.list()).thenReturn(List.of());

        EventIngestionResult result = service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "topsecret"))
                .setRawBody("not-json")
                .setContentType("text/plain"));

        assertThat(result.getEventRecord().getStatus()).isEqualTo(EventRecordStatus.IGNORED);
        EventRecord record = eventRecordRepository.savedRecords().getLast();
        assertThat(record.getRawBody()).isEqualTo("not-json");
        assertThat(record.getNormalizedEvent()).isNotNull();
        assertThat(record.getNormalizedEvent().getBody()).isEqualTo("not-json");
        assertThat(record.getNormalizedEvent().getRawBody()).isEqualTo("not-json");
        verify(eventSourceApplicationService).normalize(eq(source), any(), anyString());
        verify(eventTriggerApplicationService).list();
    }

    @Test
    void hmacAuthPersistsRedactedRequestAfterSuccessfulVerification() {
        String rawBody = "{\"event\":\"created\",\"nested\":{\"x\":1}}";
        EventSourceDefinition source = hmacSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        when(eventSourceApplicationService.normalize(eq(source), any(), anyString())).thenAnswer(invocation -> {
            IncomingEventPayload payload = invocation.getArgument(1);
            assertThat(payload.getRawBody()).isEqualTo(rawBody);
            assertThat(payload.getBody()).isEqualTo(Map.of("event", "created", "nested", Map.of("x", 1)));
            return new NormalizedEvent()
                    .setEventType("created")
                    .setEventId("evt-1")
                    .setActor("bot")
                    .setSubject("demo")
                    .setBody(payload.getBody())
                    .setRawBody(payload.getRawBody());
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
        assertThat(record.getRawBody()).isEqualTo(Map.of("event", "created", "nested", Map.of("x", 1)));
        verify(eventSourceApplicationService).normalize(eq(source), any(), anyString());
        verify(eventTriggerApplicationService).list();
        verify(eventTriggerApplicationService, never()).dispatch(any(), any(), any(), any());
    }

    @Test
    void jsonScalarBodyFallsBackToOriginalRawString() {
        EventSourceDefinition source = headerTokenSource();
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        when(eventSourceApplicationService.normalize(eq(source), any(), anyString())).thenAnswer(invocation -> {
            IncomingEventPayload payload = invocation.getArgument(1);
            assertThat(payload.getBody()).isEqualTo("\"hello\"");
            return new NormalizedEvent()
                    .setEventType("scalar")
                    .setEventId("evt-scalar")
                    .setBody(payload.getBody())
                    .setRawBody(payload.getRawBody());
        });
        when(eventTriggerApplicationService.list()).thenReturn(List.of());

        EventIngestionResult result = service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "topsecret"))
                .setRawBody("\"hello\"")
                .setContentType("application/json"));

        assertThat(result.getEventRecord().getRawBody()).isEqualTo("\"hello\"");
        assertThat(result.getEventRecord().getNormalizedEvent().getRawBody()).isEqualTo("\"hello\"");
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

    @Test
    void webhookResponseUsesCustomPayloadWhenConfigured() {
        EventSourceDefinition source = headerTokenSource()
                .setWebhookResponse(new EventSourceWebhookResponse()
                        .setSuccessStatus(202)
                        .setSuccessHeaders(Map.of("X-Ack", "ok"))
                        .setResponseProcessor(new ProcessorDefinition()
                                .setMode(ProcessorMode.TEMPLATE)
                                .setTemplate(new TemplateProcessorConfig().setTemplate(Map.of("accepted", true)))
                                .setDescription("response"))
                        .setErrorResponse(new EventSourceWebhookErrorResponse()
                                .setHttpStatus(502)
                                .setMsg("响应失败")
                                .setData(Map.of("reason", "processor"))));
        EventTrigger trigger = new EventTrigger()
                .setId("trigger-1")
                .setSourceId("source-1")
                .setTargetScriptId("script-1")
                .setSubmitMode(SubmitMode.SYNC);
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        when(eventSourceApplicationService.normalize(eq(source), any(), anyString())).thenReturn(new NormalizedEvent()
                .setSourceId("source-1")
                .setSourceKey("source-key")
                .setEventType("created")
                .setEventId("evt-1")
                .setBody(Map.of("hello", "world")));
        when(eventTriggerApplicationService.list()).thenReturn(List.of(trigger));
        when(eventTriggerApplicationService.dispatch(eq(source), eq(trigger), anyString(), any())).thenReturn(
                new EventTriggerDispatchResult(
                        new EventDispatchRecord()
                                .setId("dispatch-1")
                                .setEventId("event-1")
                                .setSourceId("source-1")
                                .setTriggerId("trigger-1")
                                .setTargetScriptId("script-1")
                                .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.EXECUTION_CREATED),
                        new ExecutionRecord()
                                .setId("exec-1")
                                .setScriptId("script-1")
                                .setEventTriggerId("trigger-1")
                                .setSubmitMode(SubmitMode.SYNC)
                                .setStatus(ExecutionStatus.SUCCESS)
                                .setOutput(Map.of("result", "ok"))
                                .setLogs(List.of(new ExecutionLogEntry().setMessage("done"))),
                        publishedScript("script-1")
                )
        );
        when(processorEngine.process(any(), any())).thenReturn(new ProcessorResult()
                .setSuccess(true)
                .setOutput(Map.of("externalCode", "accepted")));

        EventIngestionResult result = service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "topsecret"))
                .setRawBody("{\"event\":\"created\"}")
                .setContentType("application/json"));

        assertThat(result.getWebhookResponse()).isNotNull();
        assertThat(result.getWebhookResponse().getStatus()).isEqualTo(202);
        assertThat(result.getWebhookResponse().getHeaders()).containsEntry("X-Ack", "ok");
        assertThat(result.getWebhookResponse().getBody()).containsEntry("externalCode", "accepted");
        assertThat(result.getSyncExecutions()).hasSize(1);
    }

    @Test
    void webhookResponseFallsBackToConfiguredApiErrorWhenProcessorFails() {
        EventSourceDefinition source = headerTokenSource()
                .setWebhookResponse(new EventSourceWebhookResponse()
                        .setResponseProcessor(new ProcessorDefinition()
                                .setMode(ProcessorMode.TEMPLATE)
                                .setTemplate(new TemplateProcessorConfig().setTemplate(Map.of("accepted", true))))
                        .setErrorResponse(new EventSourceWebhookErrorResponse()
                                .setHttpStatus(503)
                                .setMsg("下游不可用")
                                .setData(Map.of("code", "DOWNSTREAM_UNAVAILABLE"))));
        when(eventSourceApplicationService.get("source-1")).thenReturn(source);
        when(eventSourceApplicationService.normalize(eq(source), any(), anyString())).thenReturn(new NormalizedEvent()
                .setSourceId("source-1")
                .setSourceKey("source-key"));
        when(eventTriggerApplicationService.list()).thenReturn(List.of());
        when(processorEngine.process(any(), any())).thenReturn(new ProcessorResult()
                .setSuccess(false)
                .setErrorMessage("boom"));

        EventIngestionResult result = service.ingest("source-1", payload()
                .setHeaders(Map.of("X-Webhook-Token", "topsecret"))
                .setRawBody("{\"event\":\"created\"}")
                .setContentType("application/json"));

        assertThat(result.getWebhookResponse()).isNotNull();
        assertThat(result.getWebhookResponse().getStatus()).isEqualTo(503);
        assertThat(result.getWebhookResponse().getBody()).containsEntry("status", 503);
        assertThat(result.getWebhookResponse().getBody()).containsEntry("msg", "下游不可用");
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

    private ScriptDefinition publishedScript(String id) {
        return new ScriptDefinition()
                .setId(id)
                .setName("script")
                .setOutputSchema(Map.of("type", "object", "properties", Map.of("result", Map.of("type", "string"))))
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-" + id)
                        .setScriptId(id)
                        .setVersion(1)
                        .setPublishedAt(java.time.LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("script")
                        .setOutputSchema(Map.of("type", "object", "properties", Map.of("result", Map.of("type", "string")))));
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
