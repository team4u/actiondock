package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceAuthMode;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventSourceTransport;
import org.team4u.actiondock.domain.model.EventSourceTransportType;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventSourceWebhookResponse;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class EventSourceApplicationService {
    private final EventSourceRepository eventSourceRepository;
    private final EventTriggerRepository eventTriggerRepository;
    private final ProcessorEngine processorEngine;
    private final RepositoryLocalAssetRepository repositoryLocalAssetRepository;

    public EventSourceApplicationService(EventSourceRepository eventSourceRepository,
                                         EventTriggerRepository eventTriggerRepository,
                                         ProcessorEngine processorEngine,
                                         RepositoryLocalAssetRepository repositoryLocalAssetRepository) {
        this.eventSourceRepository = eventSourceRepository;
        this.eventTriggerRepository = eventTriggerRepository;
        this.processorEngine = processorEngine;
        this.repositoryLocalAssetRepository = repositoryLocalAssetRepository;
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
        if (target.getScope() == EventSourceScope.REPOSITORY) {
            throw new IllegalArgumentException("仓库事件源仅支持通过仓库更新");
        }

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
        validateWebhookResponse(definition.getWebhookResponse(), definition.getSampleContext());

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
                .setEditable(definition.isEditable())
                .setEnabled(definition.isEnabled())
                .setTransport(transport)
                .setAuth(definition.getAuth())
                .setNormalizationProcessor(ApplicationServiceSupport.normalizeProcessor(definition.getNormalizationProcessor()))
                .setWebhookResponse(normalizeWebhookResponse(definition.getWebhookResponse()))
                .setSampleContext(definition.getSampleContext())
                .setUpdatedAt(now);
    }

    private void validateWebhookResponse(EventSourceWebhookResponse webhookResponse, Map<String, Object> sampleContext) {
        EventSourceWebhookResponse normalized = normalizeWebhookResponse(webhookResponse);
        if (normalized == null) {
            return;
        }
        if (normalized.getSuccessStatus() < 100 || normalized.getSuccessStatus() > 999) {
            throw new IllegalArgumentException("webhookResponse.successStatus 必须是合法 HTTP 状态码");
        }
        int errorStatus = normalized.getErrorResponse().getHttpStatus();
        if (errorStatus < 100 || errorStatus > 999) {
            throw new IllegalArgumentException("webhookResponse.errorResponse.httpStatus 必须是合法 HTTP 状态码");
        }
        normalized.getSuccessHeaders().forEach((name, value) -> {
            String headerName = ApplicationServiceSupport.normalize(name, "webhookResponse.successHeaders 的 header 名称不能为空");
            if (ObjectValues.stringValue(value) == null) {
                throw new IllegalArgumentException("webhookResponse.successHeaders 的值必须可转为字符串: " + headerName);
            }
        });
        ProcessorDefinition responseProcessor = ApplicationServiceSupport.normalizeProcessor(normalized.getResponseProcessor());
        if (responseProcessor == null) {
            throw new IllegalArgumentException("webhookResponse.responseProcessor 不能为空");
        }
        ProcessorContext context = ApplicationServiceSupport.contextFromSample(sampleContext);
        context.setVariables(Map.of(
                "dispatches", List.of(),
                "executions", List.of()
        ));
        ApplicationServiceSupport.validateProcessor(
                processorEngine,
                responseProcessor,
                context,
                "webhookResponse.responseProcessor"
        );
    }

    private static EventSourceWebhookResponse normalizeWebhookResponse(EventSourceWebhookResponse webhookResponse) {
        if (webhookResponse == null || webhookResponse.isEmpty()) {
            return null;
        }
        return webhookResponse
                .setSuccessStatus(webhookResponse.getSuccessStatus())
                .setSuccessHeaders(webhookResponse.getSuccessHeaders())
                .setResponseProcessor(ApplicationServiceSupport.normalizeProcessor(webhookResponse.getResponseProcessor()))
                .setErrorResponse(webhookResponse.getErrorResponse());
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
        for (EventTrigger trigger : eventTriggerRepository.findBySourceId(id)) {
            eventTriggerRepository.deleteById(trigger.getId());
        }
        repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, id)
                .map(RepositoryLocalAsset::getId)
                .ifPresent(repositoryLocalAssetRepository::deleteById);
        eventSourceRepository.deleteById(id);
    }

    public NormalizedEvent testNormalization(String sourceId, IncomingEventPayload payload) {
        EventSourceDefinition source = get(sourceId);
        return normalize(source, payload == null ? new IncomingEventPayload() : payload, null);
    }

    public NormalizedEvent normalize(EventSourceDefinition source, IncomingEventPayload payload, String eventRecordId) {
        NormalizedEvent event = buildInitialEvent(source, payload, eventRecordId);
        ProcessorDefinition processor = ApplicationServiceSupport.normalizeProcessor(source.getNormalizationProcessor());
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
        ApplicationServiceSupport.setMapField(output, "headers", event::setHeaders);
        ApplicationServiceSupport.setMapField(output, "query", event::setQuery);
        ApplicationServiceSupport.setMapField(output, "body", event::setBody);
    }

    private static void setStringField(Map<String, Object> output, String key, java.util.function.Consumer<String> setter) {
        if (output.containsKey(key)) {
            setter.accept(ObjectValues.stringValue(output.get(key)));
        }
    }

    private static void validateAuth(EventSourceAuthConfig auth) {
        if (auth != null) {
            auth.validate();
        }
    }

    private static ProcessorContext buildContext(IncomingEventPayload payload,
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
