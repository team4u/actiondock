package org.team4u.actiondock.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.json.JacksonJsonCodec;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPublishedScriptRevisionRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JpaScriptRepositoryAdapterTest {
    @Test
    void saveSerializesAndFindByIdDeserializesScriptDefinition() {
        SpringDataScriptEntityRepository repository = mock(SpringDataScriptEntityRepository.class);
        SpringDataPublishedScriptRevisionRepository publishedRevisionRepository = mock(SpringDataPublishedScriptRevisionRepository.class);
        AtomicReference<ScriptEntity> stored = new AtomicReference<>();
        AtomicReference<PublishedScriptRevisionEntity> storedRevision = new AtomicReference<>();
        when(repository.save(any())).thenAnswer(invocation -> {
            ScriptEntity entity = invocation.getArgument(0);
            stored.set(entity);
            return entity;
        });
        when(repository.findById("script-1")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
        when(publishedRevisionRepository.save(any())).thenAnswer(invocation -> {
            PublishedScriptRevisionEntity entity = invocation.getArgument(0);
            storedRevision.set(entity);
            return entity;
        });
        when(publishedRevisionRepository.findById(any())).thenAnswer(invocation -> Optional.ofNullable(storedRevision.get()));

        JpaScriptRepositoryAdapter adapter = new JpaScriptRepositoryAdapter(
                repository,
                publishedRevisionRepository,
                new JacksonJsonCodec(new ObjectMapper())
        );
        ScriptDefinition definition = new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setType(ScriptType.GROOVY)
                .setSource("return [:]")
                .setInputSchema(new LinkedHashMap<>(Map.of("type", "object")))
                .setOutputSchema(new LinkedHashMap<>(Map.of("properties", Map.of("message", Map.of("type", "string")))))
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-1")
                        .setScriptId("script-1")
                        .setVersion(3)
                        .setPublishedAt(LocalDateTime.of(2024, 1, 2, 3, 4))
                        .setName("Published Hello")
                        .setType(ScriptType.PYTHON)
                        .setSource("return {'message': 'published'}")
                        .setOwner("platform")
                        .setDescription("published desc")
                        .setTags(List.of("demo"))
                        .setInputSchema(new LinkedHashMap<>(Map.of("type", "object")))
                        .setOutputSchema(new LinkedHashMap<>(Map.of("type", "object")))
                        .setPluginDependencies(List.of(new PluginDependency()
                                .setPluginId("email-plugin")
                                .setVersionRange(">=1.0.0")
                                .setRequiredActions(List.of("send")))))
                .setVersion(3)
                .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))
                .setUpdatedAt(LocalDateTime.of(2024, 1, 2, 4, 5));

        ScriptDefinition saved = adapter.save(definition);
        ScriptDefinition found = adapter.findById("script-1").orElseThrow();

        assertThat(stored.get().getType()).isEqualTo("GROOVY");
        assertThat(stored.get().getInputSchemaJson()).contains("\"type\":\"object\"");
        assertThat(stored.get().getPublishedRevisionId()).isNotBlank();
        assertThat(stored.get().getPublishedAt()).isNotNull();
        assertThat(storedRevision.get().getType()).isEqualTo("PYTHON");
        assertThat(storedRevision.get().getSource()).isEqualTo("return {'message': 'published'}");
        assertThat(storedRevision.get().getOwner()).isEqualTo("platform");
        assertThat(storedRevision.get().getDescription()).isEqualTo("published desc");
        assertThat(storedRevision.get().getTagsJson()).contains("\"demo\"");
        assertThat(storedRevision.get().getPluginDependenciesJson()).contains("\"pluginId\":\"email-plugin\"");
        assertThat(saved.hasPublishedRevision()).isTrue();
        assertThat(found.getPublishedRevision()).isNotNull();
        assertThat(found.getPublishedRevision().getType()).isEqualTo(ScriptType.PYTHON);
        assertThat(found.getPublishedRevision().getOwner()).isEqualTo("platform");
        assertThat(found.getPublishedRevision().getDescription()).isEqualTo("published desc");
        assertThat(found.getPublishedRevision().getTags()).containsExactly("demo");
        assertThat(found.getPublishedRevision().getPluginDependencies()).hasSize(1);
        assertThat(found.getOutputSchema()).containsKey("properties");
        assertThat(found.getVersion()).isEqualTo(3);
    }

    @Test
    void deleteRemovesPublishedRevisionsBeforeDeletingScript() {
        SpringDataScriptEntityRepository repository = mock(SpringDataScriptEntityRepository.class);
        SpringDataPublishedScriptRevisionRepository publishedRevisionRepository = mock(SpringDataPublishedScriptRevisionRepository.class);
        JpaScriptRepositoryAdapter adapter = new JpaScriptRepositoryAdapter(
                repository,
                publishedRevisionRepository,
                new JacksonJsonCodec(new ObjectMapper())
        );

        adapter.deleteById("script-1");

        verify(publishedRevisionRepository).deleteByScriptId("script-1");
        verify(repository).deleteById("script-1");
    }
}
