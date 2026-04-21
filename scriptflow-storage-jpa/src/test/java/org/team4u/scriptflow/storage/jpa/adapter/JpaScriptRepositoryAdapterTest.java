package org.team4u.scriptflow.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.storage.jpa.entity.ScriptEntity;
import org.team4u.scriptflow.storage.jpa.json.JacksonJsonCodec;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JpaScriptRepositoryAdapterTest {
    @Test
    void saveSerializesAndFindByIdDeserializesScriptDefinition() {
        SpringDataScriptEntityRepository repository = mock(SpringDataScriptEntityRepository.class);
        AtomicReference<ScriptEntity> stored = new AtomicReference<>();
        when(repository.save(any())).thenAnswer(invocation -> {
            ScriptEntity entity = invocation.getArgument(0);
            stored.set(entity);
            return entity;
        });
        when(repository.findById("script-1")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));

        JpaScriptRepositoryAdapter adapter = new JpaScriptRepositoryAdapter(repository, new JacksonJsonCodec(new ObjectMapper()));
        ScriptDefinition definition = new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setType(ScriptType.GROOVY)
                .setSource("return [:]")
                .setInputSchema(new LinkedHashMap<>(Map.of("type", "object")))
                .setOutputSchema(new LinkedHashMap<>(Map.of("properties", Map.of("message", Map.of("type", "string")))))
                .setStatus(ScriptStatus.PUBLISHED)
                .setVersion(3)
                .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))
                .setUpdatedAt(LocalDateTime.of(2024, 1, 2, 4, 5));

        ScriptDefinition saved = adapter.save(definition);
        ScriptDefinition found = adapter.findById("script-1").orElseThrow();

        assertThat(stored.get().getType()).isEqualTo("GROOVY");
        assertThat(stored.get().getStatus()).isEqualTo("PUBLISHED");
        assertThat(stored.get().getInputSchemaJson()).contains("\"type\":\"object\"");
        assertThat(saved.getStatus()).isEqualTo(ScriptStatus.PUBLISHED);
        assertThat(found.getOutputSchema()).containsKey("properties");
        assertThat(found.getVersion()).isEqualTo(3);
    }
}
