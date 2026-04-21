package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.PageComponent;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.PageRepository;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PageDefinitionApplicationServiceTest {
    private final InMemoryPageRepository pageRepository = new InMemoryPageRepository();
    private final InMemoryScriptRepository scriptRepository = new InMemoryScriptRepository();
    private final PageDefinitionApplicationService service = new PageDefinitionApplicationService(pageRepository, scriptRepository);

    @Test
    void saveSetsTimestampsForNewPage() {
        PageDefinition saved = service.save(new PageDefinition().setId("page-1").setName("Demo"));

        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isEqualTo(saved.getCreatedAt());
    }

    @Test
    void savePreservesCreatedAtWhenUpdatingExistingPage() {
        LocalDateTime createdAt = LocalDateTime.of(2024, 1, 2, 3, 4);
        pageRepository.save(new PageDefinition().setId("page-1").setCreatedAt(createdAt));

        PageDefinition saved = service.save(new PageDefinition().setId("page-1").setName("Updated"));

        assertThat(saved.getCreatedAt()).isEqualTo(createdAt);
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(createdAt);
    }

    @Test
    void scaffoldCreatesInputsOutputsMappingsAndSubmitAction() {
        scriptRepository.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setInputSchema(schema(properties(
                        property("name", Map.of("type", "string", "title", "Name")),
                        property("age", Map.of("type", "integer", "title", "Age")),
                        property("enabled", Map.of("type", "boolean", "title", "Enabled"))
                )))
                .setOutputSchema(schema(properties(
                        property("message", Map.of("type", "string", "title", "Message"))
                ))));

        PageDefinition page = service.scaffold("page-1", "script-1");

        assertThat(page.getName()).isEqualTo("Hello Page");
        assertThat(page.getRenderer()).isEqualTo("amis");
        assertThat(page.getComponents())
                .extracting(PageComponent::getId, PageComponent::getRegion, PageComponent::getType, PageComponent::getName)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("input-1", "input", "text", "name"),
                        org.assertj.core.groups.Tuple.tuple("input-2", "input", "number", "age"),
                        org.assertj.core.groups.Tuple.tuple("input-3", "input", "switch", "enabled"),
                        org.assertj.core.groups.Tuple.tuple("output-1", "output", "static", "message")
                );
        assertThat(page.getBinding().getInputMapping())
                .containsEntry("name", "name")
                .containsEntry("age", "age")
                .containsEntry("enabled", "enabled");
        assertThat(page.getBinding().getOutputMapping())
                .containsEntry("message", "message");
        assertThat(page.getBinding().getSubmitMode()).isEqualTo(SubmitMode.SYNC);
        assertThat(page.getActions()).singleElement().satisfies(action -> {
            assertThat(action.getId()).isEqualTo("submit");
            assertThat(action.getType()).isEqualTo("SUBMIT");
            assertThat(action.getMethod()).isEqualTo("POST");
            assertThat(action.getOptions()).containsEntry("async", false);
        });
    }

    @Test
    void scaffoldThrowsWhenScriptMissing() {
        assertThatThrownBy(() -> service.scaffold("page-1", "missing"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Script not found: missing");
    }

    private static Map<String, Object> schema(Map<String, Object> properties) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        return schema;
    }

    private static Map<String, Object> properties(Map.Entry<String, Object>... entries) {
        Map<String, Object> properties = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : entries) {
            properties.put(entry.getKey(), entry.getValue());
        }
        return properties;
    }

    private static Map.Entry<String, Object> property(String name, Object value) {
        return Map.entry(name, value);
    }

    private static final class InMemoryPageRepository implements PageRepository {
        private final Map<String, PageDefinition> store = new LinkedHashMap<>();

        @Override
        public PageDefinition save(PageDefinition definition) {
            store.put(definition.getId(), definition);
            return definition;
        }

        @Override
        public Optional<PageDefinition> findById(String id) {
            return Optional.ofNullable(store.get(id));
        }

        @Override
        public List<PageDefinition> findAll() {
            return new ArrayList<>(store.values());
        }

        @Override
        public void deleteById(String id) {
            store.remove(id);
        }
    }

    private static final class InMemoryScriptRepository implements ScriptRepository {
        private final Map<String, ScriptDefinition> store = new LinkedHashMap<>();

        @Override
        public ScriptDefinition save(ScriptDefinition definition) {
            store.put(definition.getId(), definition);
            return definition;
        }

        @Override
        public Optional<ScriptDefinition> findById(String id) {
            return Optional.ofNullable(store.get(id));
        }

        @Override
        public List<ScriptDefinition> findAll() {
            return new ArrayList<>(store.values());
        }

        @Override
        public void deleteById(String id) {
            store.remove(id);
        }
    }
}
