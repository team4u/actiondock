package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventDispatchStatus;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventTriggerDispatchResult;
import org.team4u.actiondock.domain.model.EventSourceTransport;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EventTriggerApplicationServiceTest {

    @Test
    void saveTreatsEmptyProcessorsAsUnconfigured() {
        EventTriggerRepository eventTriggerRepository = mock(EventTriggerRepository.class);
        EventSourceRepository eventSourceRepository = mock(EventSourceRepository.class);
        EventDispatchRepository eventDispatchRepository = mock(EventDispatchRepository.class);
        ScriptRepository scriptRepository = mock(ScriptRepository.class);
        ProcessorEngine processorEngine = mock(ProcessorEngine.class);
        ExecutionApplicationService executionApplicationService = mock(ExecutionApplicationService.class);
        EventTriggerApplicationService service = new EventTriggerApplicationService(
                eventTriggerRepository,
                eventSourceRepository,
                eventDispatchRepository,
                scriptRepository,
                processorEngine,
                executionApplicationService
        );

        EventSourceDefinition source = new EventSourceDefinition()
                .setId("source-1")
                .setKey("source-key")
                .setName("Source")
                .setTransport(new EventSourceTransport());
        ScriptDefinition script = publishedScript("script-1", Map.of(
                "type", "object",
                "properties", Map.of("sourceId", Map.of("type", "string"))
        ));
        EventTrigger request = new EventTrigger()
                .setName("trigger")
                .setSourceId("source-1")
                .setTargetScriptId("script-1")
                .setFilterProcessor(new ProcessorDefinition())
                .setIdempotencyProcessor(new ProcessorDefinition())
                .setInputProcessor(new ProcessorDefinition())
                .setSubmitMode(SubmitMode.ASYNC);

        when(eventSourceRepository.findById("source-1")).thenReturn(Optional.of(source));
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(script));
        when(eventTriggerRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EventTrigger saved = service.save(request);

        assertThat(saved.getFilterProcessor()).isNull();
        assertThat(saved.getIdempotencyProcessor()).isNull();
        assertThat(saved.getInputProcessor()).isNull();
        verify(processorEngine, never()).process(any(), any());
    }

    @Test
    void dispatchUsesNormalizedEventAsDefaultMappedInputWhenInputProcessorIsEmpty() {
        EventTriggerRepository eventTriggerRepository = mock(EventTriggerRepository.class);
        EventSourceRepository eventSourceRepository = mock(EventSourceRepository.class);
        EventDispatchRepository eventDispatchRepository = mock(EventDispatchRepository.class);
        ScriptRepository scriptRepository = mock(ScriptRepository.class);
        ProcessorEngine processorEngine = mock(ProcessorEngine.class);
        ExecutionApplicationService executionApplicationService = mock(ExecutionApplicationService.class);
        EventTriggerApplicationService service = new EventTriggerApplicationService(
                eventTriggerRepository,
                eventSourceRepository,
                eventDispatchRepository,
                scriptRepository,
                processorEngine,
                executionApplicationService
        );

        EventSourceDefinition source = new EventSourceDefinition()
                .setId("source-1")
                .setKey("source-key")
                .setName("Source");
        EventTrigger trigger = new EventTrigger()
                .setId("trigger-1")
                .setName("trigger")
                .setSourceId("source-1")
                .setTargetScriptId("script-1")
                .setInputProcessor(new ProcessorDefinition())
                .setSubmitMode(SubmitMode.ASYNC);
        NormalizedEvent event = new NormalizedEvent()
                .setId("event-record-1")
                .setSourceId("source-1")
                .setSourceKey("source-key")
                .setEventType("opened")
                .setEventId("evt-1")
                .setActor("alice")
                .setSubject("demo")
                .setHeaders(Map.of("X-Test", "1"))
                .setQuery(Map.of("page", "1"))
                .setBody(Map.of("hello", "world"));
        ScriptDefinition script = publishedScript("script-1", Map.of(
                "type", "object",
                "properties", Map.of("sourceId", Map.of("type", "string")),
                "required", List.of("sourceId")
        ));

        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(script));
        when(executionApplicationService.executePublished(eq("script-1"), any(), eq(SubmitMode.ASYNC), any()))
                .thenAnswer(invocation -> new org.team4u.actiondock.domain.model.ExecutionRecord()
                        .setId("exec-1")
                        .setStatus(org.team4u.actiondock.domain.model.ExecutionStatus.PENDING)
                        .setInput(invocation.getArgument(1)));
        when(eventDispatchRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(eventTriggerRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EventTriggerDispatchResult result = service.dispatch(source, trigger, "event-record-1", event);
        EventDispatchRecord dispatch = result.dispatch();

        assertThat(dispatch.getStatus()).isEqualTo(EventDispatchStatus.EXECUTION_CREATED);
        assertThat(dispatch.getMappedInput()).containsEntry("sourceId", "source-1");
        assertThat(dispatch.getMappedInput()).containsEntry("sourceKey", "source-key");
        assertThat(dispatch.getMappedInput()).containsEntry("eventType", "opened");
        assertThat(dispatch.getMappedInput()).containsEntry("eventId", "evt-1");
        assertThat(dispatch.getMappedInput()).containsEntry("actor", "alice");
        assertThat(dispatch.getMappedInput()).containsEntry("subject", "demo");
        assertThat(dispatch.getMappedInput()).containsEntry("headers", Map.of("X-Test", "1"));
        assertThat(dispatch.getMappedInput()).containsEntry("query", Map.of("page", "1"));
        assertThat(dispatch.getMappedInput()).containsEntry("body", Map.of("hello", "world"));
        assertThat(result.execution()).isNotNull();
        assertThat(result.scriptDefinition()).isNotNull();
        verify(processorEngine, never()).process(any(), any());
    }

    private static ScriptDefinition publishedScript(String id, Map<String, Object> inputSchema) {
        PublishedScriptRevision revision = new PublishedScriptRevision()
                .setId("rev-" + id)
                .setScriptId(id)
                .setVersion(1)
                .setPublishedAt(java.time.LocalDateTime.of(2026, 4, 30, 10, 0))
                .setName("script")
                .setSource("return input")
                .setInputSchema(inputSchema)
                .setOutputSchema(Map.of("type", "object"));
        return new ScriptDefinition()
                .setId(id)
                .setName("script")
                .setSource("return input")
                .setInputSchema(inputSchema)
                .setOutputSchema(Map.of("type", "object"))
                .setPublishedRevision(revision);
    }
}
