package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScriptApplicationServiceTest {
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final ScriptEngine scriptEngine = mock(ScriptEngine.class);
    private final ScriptScheduleRepository scriptScheduleRepository = mock(ScriptScheduleRepository.class);
    private final ScriptApplicationService service =
            new ScriptApplicationService(scriptRepository, scriptEngine, scriptScheduleRepository);

    @Test
    void saveSetsDefaultsForNewScript() {
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition saved = service.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setSource("return [:]")
                .setVersion(null)
                .setStatus(null));

        assertThat(saved.getVersion()).isEqualTo(1);
        assertThat(saved.getStatus()).isEqualTo(ScriptStatus.DRAFT);
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isEqualTo(saved.getCreatedAt());
    }

    @Test
    void savePreservesExistingMetadataWhenUpdating() {
        LocalDateTime createdAt = LocalDateTime.of(2024, 1, 2, 3, 4);
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Published")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'published']")
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Published")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'published']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setCreatedAt(createdAt)
                .setVersion(7)
                .setStatus(ScriptStatus.PUBLISHED)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition saved = service.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Updated")
                .setSource("return [:]")
                .setVersion(null)
                .setStatus(null));

        assertThat(saved.getCreatedAt()).isEqualTo(createdAt);
        assertThat(saved.getVersion()).isEqualTo(7);
        assertThat(saved.getStatus()).isEqualTo(ScriptStatus.PUBLISHED);
        assertThat(saved.getPublishedSnapshot()).isNotNull();
        assertThat(saved.getPublishedSnapshot().getSource()).isEqualTo("return [message: 'published']");
        assertThat(saved.getHasUnpublishedChanges()).isTrue();
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(createdAt);
    }

    @Test
    void validateDelegatesToScriptEngine() {
        ScriptDefinition definition = new ScriptDefinition().setId("script-1");
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(definition));

        service.validate("script-1");

        verify(scriptEngine).validate(definition);
    }

    @Test
    void publishMarksScriptAsPublishedAndIncrementsVersion() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'draft']")
                .setInputSchema(Map.of("type", "object"))
                .setOutputSchema(Map.of("type", "object"))
                .setVersion(2)
                .setStatus(ScriptStatus.DRAFT)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition published = service.publish("script-1");

        assertThat(published.getStatus()).isEqualTo(ScriptStatus.PUBLISHED);
        assertThat(published.getVersion()).isEqualTo(3);
        assertThat(published.getPublishedSnapshot()).isNotNull();
        assertThat(published.getPublishedSnapshot().getSource()).isEqualTo("return [message: 'draft']");
        assertThat(published.getHasUnpublishedChanges()).isFalse();
        assertThat(published.getUpdatedAt()).isNotNull();
    }

    @Test
    void publishSnapshotKeepsNestedSchemaIndependentFromDraftChanges() {
        Map<String, Object> nestedField = new LinkedHashMap<>(Map.of("type", "string"));
        Map<String, Object> inputSchema = new LinkedHashMap<>();
        inputSchema.put("type", "object");
        inputSchema.put("properties", new LinkedHashMap<>(Map.of("message", nestedField)));

        ScriptDefinition draft = new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'draft']")
                .setInputSchema(inputSchema)
                .setOutputSchema(Map.of("type", "object"))
                .setVersion(1)
                .setStatus(ScriptStatus.DRAFT);
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(draft));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition published = service.publish("script-1");
        @SuppressWarnings("unchecked")
        Map<String, Object> currentProperties = (Map<String, Object>) published.getInputSchema().get("properties");
        @SuppressWarnings("unchecked")
        Map<String, Object> publishedProperties =
                (Map<String, Object>) published.getPublishedSnapshot().getInputSchema().get("properties");
        @SuppressWarnings("unchecked")
        Map<String, Object> currentMessageField = (Map<String, Object>) currentProperties.get("message");
        @SuppressWarnings("unchecked")
        Map<String, Object> publishedMessageField = (Map<String, Object>) publishedProperties.get("message");

        currentMessageField.put("title", "Message");

        assertThat(publishedMessageField).doesNotContainKey("title");
        assertThat(published.getHasUnpublishedChanges()).isTrue();
    }

    @Test
    void getPublishedReturnsPublishedSnapshotContent() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.PYTHON)
                .setSource("return {'message': 'draft'}")
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Live")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'live']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("properties", Map.of("message", Map.of("type", "string")))))
                .setStatus(ScriptStatus.PUBLISHED)
                .setVersion(4)));

        ScriptDefinition published = service.getPublished("script-1");

        assertThat(published.getName()).isEqualTo("Live");
        assertThat(published.getType()).isEqualTo(ScriptType.GROOVY);
        assertThat(published.getSource()).isEqualTo("return [message: 'live']");
        assertThat(published.getStatus()).isEqualTo(ScriptStatus.PUBLISHED);
        assertThat(published.getHasUnpublishedChanges()).isFalse();
    }

    @Test
    void discardDraftRestoresPublishedSnapshotWithoutIncrementingVersion() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.PYTHON)
                .setSource("return {'message': 'draft'}")
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Live")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'live']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setStatus(ScriptStatus.PUBLISHED)
                .setVersion(5)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition discarded = service.discardDraft("script-1");

        assertThat(discarded.getName()).isEqualTo("Live");
        assertThat(discarded.getType()).isEqualTo(ScriptType.GROOVY);
        assertThat(discarded.getSource()).isEqualTo("return [message: 'live']");
        assertThat(discarded.getVersion()).isEqualTo(5);
        assertThat(discarded.getHasUnpublishedChanges()).isFalse();
    }

    @Test
    void discardDraftRejectsUnpublishedScript() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setStatus(ScriptStatus.DRAFT)));

        assertThatThrownBy(() -> service.discardDraft("script-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("脚本未发布: script-1");
    }

    @Test
    void getThrowsWhenScriptMissing() {
        when(scriptRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("missing"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("脚本不存在: missing");
    }

    @Test
    void listDelegatesToRepository() {
        List<ScriptDefinition> definitions = List.of(new ScriptDefinition().setId("script-1"));
        when(scriptRepository.findAll()).thenReturn(definitions);

        assertThat(service.list()).containsExactlyElementsOf(definitions);
    }

    @Test
    void deleteRemovesSchedulesBeforeDeletingScript() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")));

        service.delete("script-1");

        verify(scriptScheduleRepository).deleteByScriptId("script-1");
        verify(scriptRepository).deleteById("script-1");
    }
}
