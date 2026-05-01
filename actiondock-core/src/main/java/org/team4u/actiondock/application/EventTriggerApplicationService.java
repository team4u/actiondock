package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionSubmissionMetadata;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class EventTriggerApplicationService {
    private final EventTriggerRepository eventTriggerRepository;
    private final EventSourceRepository eventSourceRepository;
    private final EventDispatchRepository eventDispatchRepository;
    private final ScriptRepository scriptRepository;
    private final ProcessorEngine processorEngine;
    private final ExecutionApplicationService executionApplicationService;
    private final ScriptSchemaSupport scriptSchemaSupport = new ScriptSchemaSupport();

    public EventTriggerApplicationService(EventTriggerRepository eventTriggerRepository,
                                          EventSourceRepository eventSourceRepository,
                                          EventDispatchRepository eventDispatchRepository,
                                          ScriptRepository scriptRepository,
                                          ProcessorEngine processorEngine,
                                          ExecutionApplicationService executionApplicationService) {
        this.eventTriggerRepository = eventTriggerRepository;
        this.eventSourceRepository = eventSourceRepository;
        this.eventDispatchRepository = eventDispatchRepository;
        this.scriptRepository = scriptRepository;
        this.processorEngine = processorEngine;
        this.executionApplicationService = executionApplicationService;
    }

    public List<EventTrigger> list() {
        return eventTriggerRepository.findAll();
    }

    public EventTrigger get(String id) {
        return eventTriggerRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("事件触发器不存在: " + id));
    }

    public List<EventDispatchRecord> listDispatches(String triggerId) {
        get(triggerId);
        return eventDispatchRepository.findByTriggerId(triggerId);
    }

    public EventTrigger save(EventTrigger trigger) {
        if (trigger == null) {
            throw new IllegalArgumentException("事件触发器不能为空");
        }
        LocalDateTime now = LocalDateTime.now();
        EventTrigger existing = trigger.getId() == null || trigger.getId().isBlank()
                ? null
                : eventTriggerRepository.findById(trigger.getId()).orElse(null);
        EventTrigger target = existing == null
                ? new EventTrigger()
                    .setId(trigger.getId() == null || trigger.getId().isBlank()
                            ? UUID.randomUUID().toString()
                            : trigger.getId())
                    .setCreatedAt(now)
                : existing;

        String name = ApplicationServiceSupport.normalize(trigger.getName(), "触发器名称不能为空");
        EventSourceDefinition source = eventSourceRepository.findById(
                        ApplicationServiceSupport.normalize(trigger.getSourceId(), "sourceId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + trigger.getSourceId()));
        ScriptDefinition script = scriptRepository.findById(
                        ApplicationServiceSupport.normalize(trigger.getTargetScriptId(), "targetScriptId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("目标脚本不存在: " + trigger.getTargetScriptId()));
        if (script.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("目标脚本未发布: " + script.getId());
        }

        validateProcessor(trigger.getFilterProcessor(), sampleContext(source, target), "filterProcessor");
        validateProcessor(trigger.getIdempotencyProcessor(), sampleContext(source, target), "idempotencyProcessor");
        if (trigger.getInputProcessor() == null) {
            throw new IllegalArgumentException("inputProcessor 不能为空");
        }
        validateProcessor(trigger.getInputProcessor(), sampleContext(source, target), "inputProcessor");

        target.setName(name)
                .setDescription(trigger.getDescription())
                .setEnabled(trigger.isEnabled())
                .setSourceId(source.getId())
                .setTargetScriptId(script.getId())
                .setFilterProcessor(trigger.getFilterProcessor())
                .setIdempotencyProcessor(trigger.getIdempotencyProcessor())
                .setInputProcessor(trigger.getInputProcessor())
                .setSubmitMode(trigger.getSubmitMode() == null ? SubmitMode.ASYNC : trigger.getSubmitMode())
                .setResponseView(trigger.getResponseView())
                .setUpdatedAt(now);
        return eventTriggerRepository.save(target);
    }

    public EventTrigger enable(String id) {
        EventTrigger trigger = get(id);
        trigger.setEnabled(true).setUpdatedAt(LocalDateTime.now());
        return eventTriggerRepository.save(trigger);
    }

    public EventTrigger disable(String id) {
        EventTrigger trigger = get(id);
        trigger.setEnabled(false).setUpdatedAt(LocalDateTime.now());
        return eventTriggerRepository.save(trigger);
    }

    public void delete(String id) {
        get(id);
        eventTriggerRepository.deleteById(id);
    }

    public TriggerTestResult test(String triggerId, NormalizedEvent event, boolean execute) {
        EventTrigger trigger = get(triggerId);
        EventSourceDefinition source = eventSourceRepository.findById(trigger.getSourceId())
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + trigger.getSourceId()));
        ScriptDefinition script = scriptRepository.findById(trigger.getTargetScriptId())
                .orElseThrow(() -> new IllegalArgumentException("目标脚本不存在: " + trigger.getTargetScriptId()));
        if (script.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("目标脚本未发布: " + script.getId());
        }
        ProcessorContext context = buildContext(source, trigger, event);
        TriggerTestResult result = new TriggerTestResult();
        result.setEvent(event);
        if (trigger.getFilterProcessor() != null) {
            ProcessorResult filter = processorEngine.process(trigger.getFilterProcessor(), context);
            result.setFilterResult(filter);
            result.setFilterMatched(asMatched(filter));
            if (!result.isFilterMatched()) {
                return result;
            }
        } else {
            result.setFilterMatched(true);
        }
        if (trigger.getIdempotencyProcessor() != null) {
            ProcessorResult idempotency = processorEngine.process(trigger.getIdempotencyProcessor(), context);
            result.setIdempotencyResult(idempotency);
            result.setIdempotencyKey(extractIdempotencyKey(idempotency));
        }
        ProcessorResult input = processorEngine.process(trigger.getInputProcessor(), context);
        result.setInputResult(input);
        if (!input.isSuccess()) {
            return result;
        }
        result.setMappedInput(input.getOutput());
        try {
            scriptSchemaSupport.validateInput(script.getId(), input.getOutput(), script.getPublishedSnapshot().getInputSchema());
            result.setSchemaValid(true);
        } catch (InvalidExecutionInputException exception) {
            result.setSchemaValid(false)
                    .setFieldErrors(exception.getFieldErrors());
            return result;
        }
        if (execute) {
            ExecutionRecord execution = executionApplicationService.executePublished(
                    script.getId(),
                    input.getOutput(),
                    trigger.getSubmitMode(),
                    new ExecutionSubmissionMetadata()
                            .setTriggerSource(ExecutionTriggerSource.EVENT)
                            .setEventSourceId(source.getId())
                            .setEventTriggerId(trigger.getId())
            );
            result.setExecution(execution);
        }
        return result;
    }

    public EventDispatchRecord dispatch(EventSourceDefinition source,
                                        EventTrigger trigger,
                                        String eventRecordId,
                                        NormalizedEvent event) {
        ProcessorContext context = buildContext(source, trigger, event);
        EventDispatchRecord dispatch = new EventDispatchRecord()
                .setId(UUID.randomUUID().toString())
                .setEventId(eventRecordId)
                .setSourceId(source.getId())
                .setTriggerId(trigger.getId())
                .setTargetScriptId(trigger.getTargetScriptId())
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now());
        if (trigger.getFilterProcessor() != null) {
            ProcessorResult filter = processorEngine.process(trigger.getFilterProcessor(), context);
            if (!filter.isSuccess()) {
                return eventDispatchRepository.save(dispatch
                        .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.MAPPING_FAILED)
                        .setErrorMessage(filter.getErrorMessage()));
            }
            boolean matched = asMatched(filter);
            dispatch.setFilterMatched(matched);
            if (!matched) {
                return eventDispatchRepository.save(dispatch
                        .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.FILTERED_OUT));
            }
        } else {
            dispatch.setFilterMatched(true);
        }

        if (trigger.getIdempotencyProcessor() != null) {
            ProcessorResult idempotency = processorEngine.process(trigger.getIdempotencyProcessor(), context);
            if (!idempotency.isSuccess()) {
                return eventDispatchRepository.save(dispatch
                        .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.MAPPING_FAILED)
                        .setErrorMessage(idempotency.getErrorMessage()));
            }
            String key = extractIdempotencyKey(idempotency);
            dispatch.setIdempotencyKey(key);
            if (key != null && eventDispatchRepository.findByTriggerIdAndIdempotencyKey(trigger.getId(), key).isPresent()) {
                return eventDispatchRepository.save(dispatch
                        .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.DUPLICATE));
            }
        }

        ProcessorResult input = processorEngine.process(trigger.getInputProcessor(), context);
        if (!input.isSuccess()) {
            return eventDispatchRepository.save(dispatch
                    .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.MAPPING_FAILED)
                    .setErrorMessage(input.getErrorMessage()));
        }
        dispatch.setMappedInput(input.getOutput());
        try {
            ScriptDefinition script = scriptRepository.findById(trigger.getTargetScriptId())
                    .orElseThrow(() -> new IllegalArgumentException("目标脚本不存在: " + trigger.getTargetScriptId()));
            if (script.getPublishedSnapshot() == null) {
                throw new IllegalArgumentException("目标脚本未发布: " + script.getId());
            }
            scriptSchemaSupport.validateInput(script.getId(), input.getOutput(), script.getPublishedSnapshot().getInputSchema());
            ExecutionRecord execution = executionApplicationService.executePublished(
                    script.getId(),
                    input.getOutput(),
                    trigger.getSubmitMode(),
                    new ExecutionSubmissionMetadata()
                            .setTriggerSource(ExecutionTriggerSource.EVENT)
                            .setEventSourceId(source.getId())
                            .setEventTriggerId(trigger.getId())
                            .setEventRecordId(eventRecordId)
                            .setEventDispatchId(dispatch.getId())
            );
            dispatch.setExecutionId(execution.getId())
                    .setExecutionStatus(execution.getStatus())
                    .setStatus(execution.getStatus() == org.team4u.actiondock.domain.model.ExecutionStatus.FAILED
                            ? org.team4u.actiondock.domain.model.EventDispatchStatus.EXECUTION_FAILED
                            : org.team4u.actiondock.domain.model.EventDispatchStatus.EXECUTION_CREATED)
                    .setUpdatedAt(LocalDateTime.now());
            updateTriggerAfterDispatch(trigger, eventRecordId, execution);
            eventTriggerRepository.save(trigger);
            return eventDispatchRepository.save(dispatch);
        } catch (InvalidExecutionInputException exception) {
            return eventDispatchRepository.save(dispatch
                    .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.VALIDATION_FAILED)
                    .setErrorMessage(exception.getMessage())
                    .setUpdatedAt(LocalDateTime.now()));
        } catch (RuntimeException exception) {
            return eventDispatchRepository.save(dispatch
                    .setStatus(org.team4u.actiondock.domain.model.EventDispatchStatus.EXECUTION_FAILED)
                    .setErrorMessage(ErrorDetailSupport.summarize(exception))
                    .setUpdatedAt(LocalDateTime.now()));
        }
    }

    private void validateProcessor(ProcessorDefinition processor, ProcessorContext context, String fieldName) {
        if (processor == null) {
            return;
        }
        ProcessorResult result = processorEngine.process(processor, context);
        if (!result.isSuccess()) {
            throw new IllegalArgumentException(fieldName + " 不可执行: " + result.getErrorMessage());
        }
    }

    private ProcessorContext sampleContext(EventSourceDefinition source, EventTrigger trigger) {
        Map<String, Object> sample = source.getSampleContext();
        NormalizedEvent event = new NormalizedEvent()
                .setSourceId(source.getId())
                .setSourceKey(source.getKey());
        if (sample.get("event") instanceof Map<?, ?> value) {
            Map<String, Object> eventValue = MapValueConverter.toResultMap(value);
            event.setEventType(stringValue(eventValue.get("eventType")));
            event.setEventId(stringValue(eventValue.get("eventId")));
            event.setActor(stringValue(eventValue.get("actor")));
            event.setSubject(stringValue(eventValue.get("subject")));
            event.setTimestamp(stringValue(eventValue.get("timestamp")));
            if (eventValue.get("headers") instanceof Map<?, ?> headers) {
                event.setHeaders(MapValueConverter.toResultMap(headers));
            }
            if (eventValue.get("query") instanceof Map<?, ?> query) {
                event.setQuery(MapValueConverter.toResultMap(query));
            }
            if (eventValue.get("body") instanceof Map<?, ?> body) {
                event.setBody(MapValueConverter.toResultMap(body));
            }
        }
        return buildContext(source, trigger, event);
    }

    private ProcessorContext buildContext(EventSourceDefinition source, EventTrigger trigger, NormalizedEvent event) {
        return new ProcessorContext()
                .setHeaders(event.getHeaders())
                .setQuery(event.getQuery())
                .setBody(event.getBody())
                .setEvent(eventMap(event))
                .setSource(sourceMap(source))
                .setTrigger(triggerMap(trigger));
    }

    private boolean asMatched(ProcessorResult result) {
        if (result == null || !result.isSuccess()) {
            return false;
        }
        Object value = result.getOutput().get("matched");
        if (value instanceof Boolean bool) {
            return bool;
        }
        if (value instanceof Number number) {
            return number.intValue() != 0;
        }
        if (value instanceof CharSequence text) {
            return !text.isEmpty() && !"false".equalsIgnoreCase(text.toString());
        }
        if (value instanceof java.util.Collection<?> collection) {
            return !collection.isEmpty();
        }
        return value != null;
    }

    private String extractIdempotencyKey(ProcessorResult result) {
        if (result == null || !result.isSuccess()) {
            return null;
        }
        Object value = result.getOutput().get("key");
        if (value == null) {
            return null;
        }
        String normalized = String.valueOf(value).trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private void updateTriggerAfterDispatch(EventTrigger trigger, String eventRecordId, ExecutionRecord execution) {
        trigger.setLastEventId(eventRecordId)
                .setLastTriggeredAt(LocalDateTime.now())
                .setLastExecutionId(execution.getId())
                .setLastExecutionStatus(execution.getStatus())
                .setUpdatedAt(LocalDateTime.now());
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Map<String, Object> eventMap(NormalizedEvent event) {
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

    private Map<String, Object> triggerMap(EventTrigger trigger) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", trigger.getId());
        value.put("name", trigger.getName());
        value.put("targetScriptId", trigger.getTargetScriptId());
        return value;
    }

    public static class TriggerTestResult {
        private NormalizedEvent event;
        private boolean filterMatched;
        private ProcessorResult filterResult;
        private ProcessorResult idempotencyResult;
        private String idempotencyKey;
        private ProcessorResult inputResult;
        private Map<String, Object> mappedInput = Map.of();
        private boolean schemaValid;
        private List<SchemaFieldError> fieldErrors = List.of();
        private ExecutionRecord execution;

        public NormalizedEvent getEvent() {
            return event;
        }

        public TriggerTestResult setEvent(NormalizedEvent event) {
            this.event = event;
            return this;
        }

        public boolean isFilterMatched() {
            return filterMatched;
        }

        public TriggerTestResult setFilterMatched(boolean filterMatched) {
            this.filterMatched = filterMatched;
            return this;
        }

        public ProcessorResult getFilterResult() {
            return filterResult;
        }

        public TriggerTestResult setFilterResult(ProcessorResult filterResult) {
            this.filterResult = filterResult;
            return this;
        }

        public ProcessorResult getIdempotencyResult() {
            return idempotencyResult;
        }

        public TriggerTestResult setIdempotencyResult(ProcessorResult idempotencyResult) {
            this.idempotencyResult = idempotencyResult;
            return this;
        }

        public String getIdempotencyKey() {
            return idempotencyKey;
        }

        public TriggerTestResult setIdempotencyKey(String idempotencyKey) {
            this.idempotencyKey = idempotencyKey;
            return this;
        }

        public ProcessorResult getInputResult() {
            return inputResult;
        }

        public TriggerTestResult setInputResult(ProcessorResult inputResult) {
            this.inputResult = inputResult;
            return this;
        }

        public Map<String, Object> getMappedInput() {
            return mappedInput;
        }

        public TriggerTestResult setMappedInput(Map<String, Object> mappedInput) {
            this.mappedInput = mappedInput == null ? Map.of() : mappedInput;
            return this;
        }

        public boolean isSchemaValid() {
            return schemaValid;
        }

        public TriggerTestResult setSchemaValid(boolean schemaValid) {
            this.schemaValid = schemaValid;
            return this;
        }

        public List<SchemaFieldError> getFieldErrors() {
            return fieldErrors;
        }

        public TriggerTestResult setFieldErrors(List<SchemaFieldError> fieldErrors) {
            this.fieldErrors = fieldErrors == null ? List.of() : List.copyOf(fieldErrors);
            return this;
        }

        public ExecutionRecord getExecution() {
            return execution;
        }

        public TriggerTestResult setExecution(ExecutionRecord execution) {
            this.execution = execution;
            return this;
        }
    }
}
