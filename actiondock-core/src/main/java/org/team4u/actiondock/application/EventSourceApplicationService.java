package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceAuthMode;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceTransport;
import org.team4u.actiondock.domain.model.EventSourceTransportType;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class EventSourceApplicationService {
    private final EventSourceRepository eventSourceRepository;
    private final ProcessorEngine processorEngine;

    public EventSourceApplicationService(EventSourceRepository eventSourceRepository,
                                         ProcessorEngine processorEngine) {
        this.eventSourceRepository = eventSourceRepository;
        this.processorEngine = processorEngine;
    }

    public List<EventSourceDefinition> list() {
        return eventSourceRepository.findAll();
    }

    public EventSourceDefinition get(String id) {
        return eventSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + id));
    }

    public EventSourceDefinition save(EventSourceDefinition definition) {
        if (definition == null) {
            throw new IllegalArgumentException("事件源不能为空");
        }
        LocalDateTime now = LocalDateTime.now();
        EventSourceDefinition existing = definition.getId() == null || definition.getId().isBlank()
                ? null
                : eventSourceRepository.findById(definition.getId()).orElse(null);
        EventSourceDefinition target = existing == null
                ? new EventSourceDefinition()
                    .setId(definition.getId() == null || definition.getId().isBlank()
                            ? UUID.randomUUID().toString()
                            : definition.getId())
                    .setCreatedAt(now)
                : existing;

        String key = ApplicationServiceSupport.normalize(definition.getKey(), "事件源 Key 不能为空");
        String name = ApplicationServiceSupport.normalize(definition.getName(), "事件源名称不能为空");
        eventSourceRepository.findByKey(key)
                .filter(found -> !found.getId().equals(target.getId()))
                .ifPresent(found -> {
                    throw new IllegalArgumentException("事件源 Key 已存在: " + key);
                });

        EventSourceTransport transport = definition.getTransport() == null ? new EventSourceTransport() : definition.getTransport();
        if (transport.getType() != EventSourceTransportType.HTTP_WEBHOOK) {
            throw new IllegalArgumentException("当前仅支持 HTTP_WEBHOOK");
        }
        transport.setEndpointPath("/api/event-sources/" + target.getId() + "/events");
        if (transport.getContentTypes().isEmpty()) {
            transport.setContentTypes(List.of("application/json"));
        }

        validateAuth(definition.getAuth());
        validateProcessor(definition.getNormalizationProcessor(), definition.getSampleContext(), "normalizationProcessor");

        target.setKey(key)
                .setName(name)
                .setDescription(definition.getDescription())
                .setEnabled(definition.isEnabled())
                .setTransport(transport)
                .setAuth(definition.getAuth())
                .setNormalizationProcessor(definition.getNormalizationProcessor())
                .setSampleContext(definition.getSampleContext())
                .setUpdatedAt(now);
        return eventSourceRepository.save(target);
    }

    public EventSourceDefinition enable(String id) {
        EventSourceDefinition source = get(id);
        source.setEnabled(true).setUpdatedAt(LocalDateTime.now());
        return eventSourceRepository.save(source);
    }

    public EventSourceDefinition disable(String id) {
        EventSourceDefinition source = get(id);
        source.setEnabled(false).setUpdatedAt(LocalDateTime.now());
        return eventSourceRepository.save(source);
    }

    public EventSourceDefinition markReceived(String id, LocalDateTime receivedAt) {
        EventSourceDefinition source = get(id);
        LocalDateTime timestamp = receivedAt == null ? LocalDateTime.now() : receivedAt;
        source.setLastReceivedAt(timestamp).setUpdatedAt(timestamp);
        return eventSourceRepository.save(source);
    }

    public void delete(String id) {
        get(id);
        eventSourceRepository.deleteById(id);
    }

    public NormalizedEvent testNormalization(String sourceId, IncomingEventPayload payload) {
        EventSourceDefinition source = get(sourceId);
        return normalize(source, payload == null ? new IncomingEventPayload() : payload, null);
    }

    public NormalizedEvent normalize(EventSourceDefinition source, IncomingEventPayload payload, String eventRecordId) {
        LocalDateTime now = LocalDateTime.now();
        NormalizedEvent event = new NormalizedEvent()
                .setId(eventRecordId)
                .setSourceId(source.getId())
                .setSourceKey(source.getKey())
                .setHeaders(payload.getHeaders())
                .setQuery(payload.getQuery())
                .setBody(payload.getBody())
                .setReceivedAt(now);
        ProcessorDefinition processor = source.getNormalizationProcessor();
        if (processor == null) {
            return event;
        }
        ProcessorResult result = processorEngine.process(processor, buildContext(payload, source, null, event));
        if (!result.isSuccess()) {
            throw new IllegalArgumentException("标准化失败: " + result.getErrorMessage());
        }
        Map<String, Object> output = result.getOutput();
        if (output.containsKey("eventType")) {
            event.setEventType(stringValue(output.get("eventType")));
        }
        if (output.containsKey("eventId")) {
            event.setEventId(stringValue(output.get("eventId")));
        }
        if (output.containsKey("actor")) {
            event.setActor(stringValue(output.get("actor")));
        }
        if (output.containsKey("subject")) {
            event.setSubject(stringValue(output.get("subject")));
        }
        if (output.containsKey("timestamp")) {
            event.setTimestamp(stringValue(output.get("timestamp")));
        }
        if (output.get("headers") instanceof Map<?, ?> headers) {
            event.setHeaders(MapValueConverter.toResultMap(headers));
        }
        if (output.get("query") instanceof Map<?, ?> query) {
            event.setQuery(MapValueConverter.toResultMap(query));
        }
        if (output.get("body") instanceof Map<?, ?> body) {
            event.setBody(MapValueConverter.toResultMap(body));
        }
        return event;
    }

    private void validateAuth(EventSourceAuthConfig auth) {
        if (auth == null || auth.getMode() == null || auth.getMode() == EventSourceAuthMode.NONE) {
            return;
        }
        switch (auth.getMode()) {
            case HEADER_TOKEN -> ApplicationServiceSupport.normalize(auth.getTokenHeader(), "Header Token 缺少 tokenHeader");
            case QUERY_TOKEN -> ApplicationServiceSupport.normalize(auth.getTokenQueryParam(), "Query Token 缺少 tokenQueryParam");
            case HMAC_SHA256 -> {
                ApplicationServiceSupport.normalize(auth.getSignatureHeader(), "HMAC 缺少 signatureHeader");
                ApplicationServiceSupport.normalize(auth.getSecretConfigKey(), "HMAC 缺少 secretConfigKey");
            }
            default -> {
            }
        }
    }

    private void validateProcessor(ProcessorDefinition processor, Map<String, Object> sampleContext, String fieldName) {
        if (processor == null) {
            return;
        }
        ProcessorResult result = processorEngine.process(processor, contextFromSample(sampleContext));
        if (!result.isSuccess()) {
            throw new IllegalArgumentException(fieldName + " 不可执行: " + result.getErrorMessage());
        }
    }

    private ProcessorContext contextFromSample(Map<String, Object> sampleContext) {
        if (sampleContext == null || sampleContext.isEmpty()) {
            return new ProcessorContext();
        }
        ProcessorContext context = new ProcessorContext();
        if (sampleContext.get("event") instanceof Map<?, ?> event) {
            context.setEvent(MapValueConverter.toResultMap(event));
        }
        if (sampleContext.get("headers") instanceof Map<?, ?> headers) {
            context.setHeaders(MapValueConverter.toResultMap(headers));
        }
        if (sampleContext.get("query") instanceof Map<?, ?> query) {
            context.setQuery(MapValueConverter.toResultMap(query));
        }
        if (sampleContext.get("body") instanceof Map<?, ?> body) {
            context.setBody(MapValueConverter.toResultMap(body));
        }
        if (sampleContext.get("source") instanceof Map<?, ?> source) {
            context.setSource(MapValueConverter.toResultMap(source));
        }
        if (sampleContext.get("trigger") instanceof Map<?, ?> trigger) {
            context.setTrigger(MapValueConverter.toResultMap(trigger));
        }
        if (sampleContext.get("variables") instanceof Map<?, ?> variables) {
            context.setVariables(MapValueConverter.toResultMap(variables));
        }
        return context;
    }

    ProcessorContext buildContext(IncomingEventPayload payload,
                                  EventSourceDefinition source,
                                  Map<String, Object> trigger,
                                  NormalizedEvent event) {
        return new ProcessorContext()
                .setHeaders(payload.getHeaders())
                .setQuery(payload.getQuery())
                .setBody(payload.getBody())
                .setEvent(toEventMap(event))
                .setSource(sourceMap(source))
                .setTrigger(trigger == null ? Map.of() : trigger);
    }

    private Map<String, Object> toEventMap(NormalizedEvent event) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", event.getId());
        value.put("sourceId", event.getSourceId());
        value.put("sourceKey", event.getSourceKey());
        value.put("eventType", event.getEventType());
        value.put("eventId", event.getEventId());
        value.put("actor", event.getActor());
        value.put("subject", event.getSubject());
        value.put("timestamp", event.getTimestamp());
        value.put("headers", event.getHeaders());
        value.put("query", event.getQuery());
        value.put("body", event.getBody());
        value.put("receivedAt", event.getReceivedAt() == null ? null : event.getReceivedAt().toString());
        return value;
    }

    private Map<String, Object> sourceMap(EventSourceDefinition source) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", source.getId());
        value.put("key", source.getKey());
        value.put("name", source.getName());
        return value;
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
