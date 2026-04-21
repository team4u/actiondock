package org.team4u.scriptflow.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageBinding;
import org.team4u.scriptflow.domain.model.PageComponent;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.PageLayout;
import org.team4u.scriptflow.storage.jpa.entity.PageEntity;
import org.team4u.scriptflow.storage.jpa.json.JacksonJsonCodec;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataPageEntityRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JpaPageRepositoryAdapterTest {
    @Test
    void saveSerializesAndFindByIdDeserializesPageDefinition() {
        SpringDataPageEntityRepository repository = mock(SpringDataPageEntityRepository.class);
        AtomicReference<PageEntity> stored = new AtomicReference<>();
        when(repository.save(any())).thenAnswer(invocation -> {
            PageEntity entity = invocation.getArgument(0);
            stored.set(entity);
            return entity;
        });
        when(repository.findById("page-1")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));

        JpaPageRepositoryAdapter adapter = new JpaPageRepositoryAdapter(repository, new JacksonJsonCodec(new ObjectMapper()));
        PageDefinition definition = new PageDefinition()
                .setId("page-1")
                .setName("Demo")
                .setRenderer("amis")
                .setLayout(new PageLayout().setFormMode("vertical"))
                .setComponents(List.of(new PageComponent().setId("input-1").setName("name").setType("text")))
                .setActions(List.of(new PageActionDefinition().setId("submit").setType("SUBMIT")))
                .setBinding(new PageBinding().setScriptId("script-1").setInputMapping(Map.of("name", "name")))
                .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))
                .setUpdatedAt(LocalDateTime.of(2024, 1, 2, 4, 5));

        PageDefinition saved = adapter.save(definition);
        PageDefinition found = adapter.findById("page-1").orElseThrow();

        assertThat(stored.get().getLayoutJson()).contains("\"formMode\":\"vertical\"");
        assertThat(stored.get().getComponentsJson()).contains("\"name\":\"name\"");
        assertThat(saved.getBinding().getScriptId()).isEqualTo("script-1");
        assertThat(found.getComponents()).singleElement().satisfies(component -> {
            assertThat(component.getId()).isEqualTo("input-1");
            assertThat(component.getType()).isEqualTo("text");
        });
    }

    @Test
    void findByIdSuppliesDefaultsForMissingJsonFields() {
        SpringDataPageEntityRepository repository = mock(SpringDataPageEntityRepository.class);
        when(repository.findById("page-1")).thenReturn(Optional.of(new PageEntity() {{
            setId("page-1");
            setName("Demo");
            setRenderer("amis");
        }}));

        JpaPageRepositoryAdapter adapter = new JpaPageRepositoryAdapter(repository, new JacksonJsonCodec(new ObjectMapper()));
        PageDefinition found = adapter.findById("page-1").orElseThrow();

        assertThat(found.getLayout()).isNotNull();
        assertThat(found.getBinding()).isNotNull();
        assertThat(found.getComponents()).isEmpty();
        assertThat(found.getActions()).isEmpty();
    }
}
