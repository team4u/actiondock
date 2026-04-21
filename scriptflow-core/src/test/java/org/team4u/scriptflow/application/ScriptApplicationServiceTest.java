package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
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
    private final ScriptApplicationService service = new ScriptApplicationService(scriptRepository, scriptEngine);

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
                .setVersion(2)
                .setStatus(ScriptStatus.DRAFT)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition published = service.publish("script-1");

        assertThat(published.getStatus()).isEqualTo(ScriptStatus.PUBLISHED);
        assertThat(published.getVersion()).isEqualTo(3);
        assertThat(published.getUpdatedAt()).isNotNull();
    }

    @Test
    void getThrowsWhenScriptMissing() {
        when(scriptRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("missing"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Script not found: missing");
    }

    @Test
    void listDelegatesToRepository() {
        List<ScriptDefinition> definitions = List.of(new ScriptDefinition().setId("script-1"));
        when(scriptRepository.findAll()).thenReturn(definitions);

        assertThat(service.list()).containsExactlyElementsOf(definitions);
    }
}
