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
        EventSourceDefinition target = resolveTarget(definition, now);

        String key = ApplicationServiceSupport.normalize(definition.getKey(), "事件源 Key 不能为空");
        String name = ApplicationServiceSupport.normalize(definition.getName(), "事件源名称不能为空");
        validateKeyUniqueness(key, target.getId());

        EventSourceTransport transport = configureTransport(definition.getTransport(), target.getId());

        validateAuth(definition.getAuth());
        ApplicationServiceSupport.validateProcessor(
                processorEngine,
                definition.getNormalizationProcessor(),
                ApplicationServiceSupport.contextFromSample(definition.getSampleContext()),
                "normalizationProcessor");

        applyToTarget(target, definition, key, name, transport, now);
        return eventSourceRepository.save(target);
    }

    private EventSourceDefinition resolveTarget(EventSourceDefinition definition, LocalDateTime now) {
        EventSourceDefinition existing = definition.getId() == null || definition.getId().isBlank()
                ? null
                : eventSourceRepository.findById(definition.getId()).orElse(null);
        return existing == null
                ? new EventSourceDefinition()
                    .setId(definition.getId() == null || definition.getId().isBlank()
                            ? UUID.randomUUID().toString()
                            : definition.getId())
                    .setCreatedAt(now)
                : existing;
    }

    private void validateKeyUniqueness(String key, String targetId) {
        eventSourceRepository.findByKey(key)
                .filter(found -> !found.getId().equals(targetId))
                .ifPresent(found -> {
                    throw new IllegalArgumentException("事件源 Key 已存在: " + key);
                });
    }

    private static EventSourceTransport configureTransport(EventSourceTransport transport, String targetId) {
        EventSourceTransport result = transport == null ? new EventSourceTransport() : transport;
        if (result.getType() != EventSourceTransportType.HTTP_WEBHOOK) {
            throw new IllegalArgumentException("当前仅支持 HTTP_WEBHOOK");
        }
        result.setEndpointPath("/api/event-sources/" + targetId + "/events");
        if (result.getContentTypes().isEmpty()) {
            result.setContentTypes(List.of("application/json"));
        }
        return result;
    }

    private static void applyToTarget(EventSourceDefinition target,
                                      EventSourceDefinition definition,
                                      String key,
                                      String name,
                                      EventSourceTransport transport,
                                      LocalDateTime now) {
        target.setKey(key)
                .setName(name)
                .setDescription(definition.getDescription())
                .setEnabled(definition.isEnabled())
                .setTransport(transport)
                .setAuth(definition.getAuth())
                .setNormalizationProcessor(definition.getNormalizationProcessor())
                .setSampleContext(definition.getSampleContext())
                .setUpdatedAt(now);
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
        NormalizedEvent event = buildInitialEvent(source, payload, eventRecordId);
        ProcessorDefinition processor = source.getNormalizationProcessor();
        if (processor == null) {
            return event;
        }
        ProcessorResult result = processorEngine.process(processor, buildContext(payload, source, null, event));
        if (!result.isSuccess()) {
            throw new IllegalArgumentException("标准化失败: " + result.getErrorMessage());
        }
        applyProcessorOutput(event, result.getOutput());
        return event;
    }

    private static NormalizedEvent buildInitialEvent(EventSourceDefinition source,
                                                     IncomingEventPayload payload,
                                                     String eventRecordId) {
        return new NormalizedEvent()
                .setId(eventRecordId)
                .setSourceId(source.getId())
                .setSourceKey(source.getKey())
                .setHeaders(payload.getHeaders())
                .setQuery(payload.getQuery())
                .setBody(payload.getBody())
                .setReceivedAt(LocalDateTime.now());
    }

    private static void applyProcessorOutput(NormalizedEvent event, Map<String, Object> output) {
        setStringField(output, "eventType", event::setEventType);
        setStringField(output, "eventId", event::setEventId);
        setStringField(output, "actor", event::setActor);
        setStringField(output, "subject", event::setSubject);
        setStringField(output, "timestamp", event::setTimestamp);
        setMapField(output, "headers", event::setHeaders);
        setMapField(output, "query", event::setQuery);
        setMapField(output, "body", event::setBody);
    }

    private static void setStringField(Map<String, Object> output, String key, java.util.function.Consumer<String> setter) {
        if (output.containsKey(key)) {
            setter.accept(ObjectValues.stringValue(output.get(key)));
        }
    }

    private static void setMapField(Map<String, Object> output, String key, java.util.function.Consumer<Map<String, Object>> setter) {
        if (output.get(key) instanceof Map<?, ?> map) {
            setter.accept(MapValueConverter.toResultMap(map));
        }
    }

    private static void validateAuth(EventSourceAuthConfig auth) {
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

    static ProcessorContext buildContext(IncomingEventPayload payload,
                                  EventSourceDefinition source,
                                  Map<String, Object> trigger,
                                  NormalizedEvent event) {
        return new ProcessorContext()
                .setHeaders(payload.getHeaders())
                .setQuery(payload.getQuery())
                .setBody(payload.getBody())
                .setEvent(ApplicationServiceSupport.toEventMap(event))
                .setSource(ApplicationServiceSupport.toSourceMap(source))
                .setTrigger(trigger == null ? Map.of() : trigger);
    }

}
