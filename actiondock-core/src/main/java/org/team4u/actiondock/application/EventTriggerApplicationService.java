package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventDispatchStatus;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionSubmissionMetadata;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorContext;
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
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.team4u.actiondock.application.ObjectValues.stringValue;

public class EventTriggerApplicationService {
    private final EventTriggerRepository eventTriggerRepository;
    private final EventSourceRepository eventSourceRepository;
    private final EventDispatchRepository eventDispatchRepository;
    private final ScriptRepository scriptRepository;
    private final ProcessorEngine processorEngine;
    private final ExecutionApplicationService executionApplicationService;

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
        EventTrigger target = resolveOrCreateTarget(trigger, now);

        String name = ApplicationServiceSupport.normalize(trigger.getName(), "触发器名称不能为空");
        EventSourceDefinition source = eventSourceRepository.findById(
                        ApplicationServiceSupport.normalize(trigger.getSourceId(), "sourceId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + trigger.getSourceId()));
        ScriptDefinition script = scriptRepository.findById(
                        ApplicationServiceSupport.normalize(trigger.getTargetScriptId(), "targetScriptId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("目标脚本不存在: " + trigger.getTargetScriptId()));
        requirePublished(script);

        ProcessorContext sampleCtx = sampleContext(source, target);
        validateProcessors(trigger, sampleCtx);

        applyTriggerFields(target, trigger, name, source, script, now);
        return eventTriggerRepository.save(target);
    }

    private EventTrigger resolveOrCreateTarget(EventTrigger trigger, LocalDateTime now) {
        EventTrigger existing = trigger.getId() == null || trigger.getId().isBlank()
                ? null
                : eventTriggerRepository.findById(trigger.getId()).orElse(null);
        return existing == null
                ? new EventTrigger()
                    .setId(trigger.getId() == null || trigger.getId().isBlank()
                            ? UUID.randomUUID().toString()
                            : trigger.getId())
                    .setCreatedAt(now)
                : existing;
    }

    private void validateProcessors(EventTrigger trigger, ProcessorContext sampleCtx) {
        ApplicationServiceSupport.validateProcessor(processorEngine, trigger.getFilterProcessor(), sampleCtx, "filterProcessor");
        ApplicationServiceSupport.validateProcessor(processorEngine, trigger.getIdempotencyProcessor(), sampleCtx, "idempotencyProcessor");
        if (trigger.getInputProcessor() == null) {
            throw new IllegalArgumentException("inputProcessor 不能为空");
        }
        ApplicationServiceSupport.validateProcessor(processorEngine, trigger.getInputProcessor(), sampleCtx, "inputProcessor");
    }

    private static void applyTriggerFields(EventTrigger target, EventTrigger trigger,
                                            String name, EventSourceDefinition source,
                                            ScriptDefinition script, LocalDateTime now) {
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
    }

    public EventTrigger enable(String id) {
        return setEnabled(id, true);
    }

    public EventTrigger disable(String id) {
        return setEnabled(id, false);
    }

    private EventTrigger setEnabled(String id, boolean enabled) {
        EventTrigger trigger = get(id);
        trigger.setEnabled(enabled).setUpdatedAt(LocalDateTime.now());
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
        requirePublished(script);

        ProcessorContext context = buildContext(source, trigger, event);
        TestProcessorResult result = processTestPipeline(trigger, script, context, event);
        if (result.earlyReturn != null) {
            return result.earlyReturn;
        }

        ExecutionRecord execution = execute ? submitTestExecution(source, trigger, script, result.mappedInput) : null;
        return new TriggerTestResult(event, result.filterResult, result.filterMatched,
                result.idempotencyResult, result.idempotencyKey, result.inputResult,
                result.mappedInput, true, List.of(), execution);
    }

    private TestProcessorResult processTestPipeline(EventTrigger trigger, ScriptDefinition script,
                                                     ProcessorContext context, NormalizedEvent event) {
        ProcessorResult filterResult = null;
        boolean filterMatched = true;
        if (trigger.getFilterProcessor() != null) {
            filterResult = processorEngine.process(trigger.getFilterProcessor(), context);
            filterMatched = asMatched(filterResult);
            if (!filterMatched) {
                return TestProcessorResult.early(event, filterResult, false, null, null, null, Map.of());
            }
        }

        ProcessorResult idempotencyResult = null;
        String idempotencyKey = null;
        if (trigger.getIdempotencyProcessor() != null) {
            idempotencyResult = processorEngine.process(trigger.getIdempotencyProcessor(), context);
            idempotencyKey = extractIdempotencyKey(idempotencyResult);
        }

        ProcessorResult inputResult = processorEngine.process(trigger.getInputProcessor(), context);
        if (!inputResult.isSuccess()) {
            return TestProcessorResult.early(event, filterResult, filterMatched, idempotencyResult, idempotencyKey, inputResult, Map.of());
        }

        Map<String, Object> mappedInput = inputResult.getOutput();
        try {
            ScriptSchemaSupport.validateInput(script.getId(), mappedInput, script.getPublishedSnapshot().getInputSchema());
        } catch (InvalidExecutionInputException exception) {
            TriggerTestResult early = new TriggerTestResult(event, filterResult, filterMatched,
                    idempotencyResult, idempotencyKey, inputResult, mappedInput, false, exception.getFieldErrors(), null);
            return new TestProcessorResult(early, filterResult, filterMatched, idempotencyResult, idempotencyKey, inputResult, mappedInput);
        }

        return new TestProcessorResult(null, filterResult, filterMatched, idempotencyResult, idempotencyKey, inputResult, mappedInput);
    }

    private ExecutionRecord submitTestExecution(EventSourceDefinition source, EventTrigger trigger,
                                                 ScriptDefinition script, Map<String, Object> mappedInput) {
        return executionApplicationService.executePublished(
                script.getId(),
                mappedInput,
                trigger.getSubmitMode(),
                new ExecutionSubmissionMetadata()
                        .setTriggerSource(ExecutionTriggerSource.EVENT)
                        .setEventSourceId(source.getId())
                        .setEventTriggerId(trigger.getId())
        );
    }

    private record TestProcessorResult(
            TriggerTestResult earlyReturn,
            ProcessorResult filterResult,
            boolean filterMatched,
            ProcessorResult idempotencyResult,
            String idempotencyKey,
            ProcessorResult inputResult,
            Map<String, Object> mappedInput
    ) {
        static TestProcessorResult early(NormalizedEvent event, ProcessorResult filterResult,
                                          boolean filterMatched, ProcessorResult idempotencyResult,
                                          String idempotencyKey, ProcessorResult inputResult,
                                          Map<String, Object> mappedInput) {
            TriggerTestResult early = new TriggerTestResult(event, filterResult, filterMatched,
                    idempotencyResult, idempotencyKey, inputResult, mappedInput, false, List.of(), null);
            return new TestProcessorResult(early, filterResult, filterMatched, idempotencyResult, idempotencyKey, inputResult, mappedInput);
        }
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

        EventDispatchRecord filterResult = applyFilter(trigger, context, dispatch);
        if (filterResult != null) {
            return filterResult;
        }

        EventDispatchRecord idempotencyResult = checkIdempotency(trigger, context, dispatch);
        if (idempotencyResult != null) {
            return idempotencyResult;
        }

        ProcessorResult input = processorEngine.process(trigger.getInputProcessor(), context);
        if (!input.isSuccess()) {
            return failDispatch(dispatch, EventDispatchStatus.MAPPING_FAILED, input.getErrorMessage());
        }
        dispatch.setMappedInput(input.getOutput());
        return executeTargetScript(source, trigger, eventRecordId, dispatch, input.getOutput());
    }

    private EventDispatchRecord applyFilter(EventTrigger trigger, ProcessorContext context, EventDispatchRecord dispatch) {
        if (trigger.getFilterProcessor() == null) {
            dispatch.setFilterMatched(true);
            return null;
        }
        ProcessorResult filter = processorEngine.process(trigger.getFilterProcessor(), context);
        if (!filter.isSuccess()) {
            return failDispatch(dispatch, EventDispatchStatus.MAPPING_FAILED, filter.getErrorMessage());
        }
        boolean matched = asMatched(filter);
        dispatch.setFilterMatched(matched);
        return matched ? null : failDispatch(dispatch, EventDispatchStatus.FILTERED_OUT, null);
    }

    private EventDispatchRecord checkIdempotency(EventTrigger trigger, ProcessorContext context, EventDispatchRecord dispatch) {
        if (trigger.getIdempotencyProcessor() == null) {
            return null;
        }
        ProcessorResult idempotency = processorEngine.process(trigger.getIdempotencyProcessor(), context);
        if (!idempotency.isSuccess()) {
            return failDispatch(dispatch, EventDispatchStatus.MAPPING_FAILED, idempotency.getErrorMessage());
        }
        String key = extractIdempotencyKey(idempotency);
        dispatch.setIdempotencyKey(key);
        if (key != null && eventDispatchRepository.findByTriggerIdAndIdempotencyKey(trigger.getId(), key).isPresent()) {
            return failDispatch(dispatch, EventDispatchStatus.DUPLICATE, null);
        }
        return null;
    }

    private EventDispatchRecord executeTargetScript(EventSourceDefinition source,
                                                     EventTrigger trigger,
                                                     String eventRecordId,
                                                     EventDispatchRecord dispatch,
                                                     Map<String, Object> mappedInput) {
        try {
            ScriptDefinition script = scriptRepository.findById(trigger.getTargetScriptId())
                    .orElseThrow(() -> new IllegalArgumentException("目标脚本不存在: " + trigger.getTargetScriptId()));
            requirePublished(script);
            ScriptSchemaSupport.validateInput(script.getId(), mappedInput, script.getPublishedSnapshot().getInputSchema());
            ExecutionRecord execution = executionApplicationService.executePublished(
                    script.getId(),
                    mappedInput,
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
                            ? EventDispatchStatus.EXECUTION_FAILED
                            : EventDispatchStatus.EXECUTION_CREATED)
                    .setUpdatedAt(LocalDateTime.now());
            updateTriggerAfterDispatch(trigger, eventRecordId, execution);
            eventTriggerRepository.save(trigger);
            return eventDispatchRepository.save(dispatch);
        } catch (InvalidExecutionInputException exception) {
            return failDispatch(dispatch, EventDispatchStatus.VALIDATION_FAILED, exception.getMessage());
        } catch (RuntimeException exception) {
            return failDispatch(dispatch, EventDispatchStatus.EXECUTION_FAILED, ErrorDetailSupport.summarize(exception));
        }
    }

    private EventDispatchRecord failDispatch(EventDispatchRecord dispatch,
                                              EventDispatchStatus status,
                                              String errorMessage) {
        dispatch.setStatus(status).setErrorMessage(errorMessage).setUpdatedAt(LocalDateTime.now());
        return eventDispatchRepository.save(dispatch);
    }

    private static ProcessorContext sampleContext(EventSourceDefinition source, EventTrigger trigger) {
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

    private static ProcessorContext buildContext(EventSourceDefinition source, EventTrigger trigger, NormalizedEvent event) {
        return new ProcessorContext()
                .setHeaders(event.getHeaders())
                .setQuery(event.getQuery())
                .setBody(event.getBody())
                .setEvent(ApplicationServiceSupport.toEventMap(event))
                .setSource(ApplicationServiceSupport.toSourceMap(source))
                .setTrigger(triggerMap(trigger));
    }

    private static boolean asMatched(ProcessorResult result) {
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
        if (value instanceof Collection<?> collection) {
            return !collection.isEmpty();
        }
        return value != null;
    }

    private static String extractIdempotencyKey(ProcessorResult result) {
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

    private static void updateTriggerAfterDispatch(EventTrigger trigger, String eventRecordId, ExecutionRecord execution) {
        trigger.setLastEventId(eventRecordId)
                .setLastTriggeredAt(LocalDateTime.now())
                .setLastExecutionId(execution.getId())
                .setLastExecutionStatus(execution.getStatus())
                .setUpdatedAt(LocalDateTime.now());
    }


    private static void requirePublished(ScriptDefinition script) {
        if (script.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("目标脚本未发布: " + script.getId());
        }
    }

    private static Map<String, Object> triggerMap(EventTrigger trigger) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", trigger.getId());
        value.put("name", trigger.getName());
        value.put("targetScriptId", trigger.getTargetScriptId());
        return value;
    }

    public record TriggerTestResult(
            NormalizedEvent event,
            ProcessorResult filterResult,
            boolean filterMatched,
            ProcessorResult idempotencyResult,
            String idempotencyKey,
            ProcessorResult inputResult,
            Map<String, Object> mappedInput,
            boolean schemaValid,
            List<SchemaFieldError> fieldErrors,
            ExecutionRecord execution
    ) {
        public TriggerTestResult {
            mappedInput = mappedInput == null ? Map.of() : mappedInput;
            fieldErrors = fieldErrors == null ? List.of() : List.copyOf(fieldErrors);
        }
    }
}
