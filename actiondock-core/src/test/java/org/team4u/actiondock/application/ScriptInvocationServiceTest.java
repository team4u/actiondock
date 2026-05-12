package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScriptInvocationServiceTest {
    @Test
    void invokePublishedUsesPublishedSnapshotAndNormalizesScalarResult() {
        RecordingScriptEngine scriptEngine = new RecordingScriptEngine();
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(publishedScript("child")), () -> scriptEngine);

        Object result = service.invokePublished(
                "child",
                new ScriptDefinition().setId("parent"),
                new ScriptExecutionContext().setScriptStack(List.of("parent")),
                Map.of("name", "Alice")
        );

        assertThat(result).isEqualTo(Map.of("result", 42));
        assertThat(scriptEngine.lastDefinition.getSource()).isEqualTo("published-source");
        assertThat(scriptEngine.lastInput).containsEntry("name", "Alice");
        assertThat(scriptEngine.lastContext.getScriptStack()).containsExactly("parent", "child");
    }

    @Test
    void invokePublishedNormalizesCharSequenceInputsBeforeValidation() {
        RecordingScriptEngine scriptEngine = new RecordingScriptEngine();
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(publishedScript("child")), () -> scriptEngine);

        Object result = service.invokePublished(
                "child",
                new ScriptDefinition().setId("parent"),
                new ScriptExecutionContext().setScriptStack(List.of("parent")),
                Map.of("name", new StringBuilder("Alice"))
        );

        assertThat(result).isEqualTo(Map.of("result", 42));
        assertThat(scriptEngine.lastInput.get("name")).isEqualTo("Alice").isInstanceOf(String.class);
    }

    @Test
    void invokePublishedIncludesCalleeScriptIdWhenNestedValidationFails() {
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(publishedScript("child")), RecordingScriptEngine::new);

        InvalidExecutionInputException exception = catchThrowableOfType(() -> service.invokePublished(
                "child",
                new ScriptDefinition().setId("parent"),
                new ScriptExecutionContext().setScriptStack(List.of("parent")),
                Map.of("name", 123)
        ), InvalidExecutionInputException.class);

        assertThat(exception)
                .isNotNull()
                .hasMessage("调用脚本 child 失败: 脚本 child 输入参数校验失败: Name 类型应为 string，实际为 integer");
        assertThat(exception.getFieldErrors()).singleElement()
                .satisfies(fieldError -> assertThat(fieldError.field()).isEqualTo("name"));
    }

    @Test
    void invokePublishedIncludesCalleeScriptIdWhenNestedExecutionFails() {
        ScriptInvocationService service = new ScriptInvocationService(
                repositoryWith(publishedScript("child")),
                () -> new RecordingScriptEngine() {
                    @Override
                    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
                        throw new IllegalStateException("boom");
                    }
                }
        );

        assertThatThrownBy(() -> service.invokePublished(
                "child",
                new ScriptDefinition().setId("parent"),
                new ScriptExecutionContext().setScriptStack(List.of("parent")),
                Map.of("name", "Alice")
        ))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("调用脚本 child 失败: boom");
    }

    @Test
    void invokePublishedDetectsRecursiveCalls() {
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(publishedScript("child")), RecordingScriptEngine::new);

        assertThatThrownBy(() -> service.invokePublished(
                "child",
                new ScriptDefinition().setId("parent"),
                new ScriptExecutionContext().setScriptStack(List.of("parent", "child")),
                Map.of()
        ))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("调用脚本 child 失败: 检测到脚本循环调用: parent -> child -> child");
    }

    @Test
    void invokePublishedPrefixesLogsForCallee() {
        RecordingScriptEngine scriptEngine = new RecordingScriptEngine() {
            @Override
            public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
                executionContext.log(ExecutionLogLevel.INFO, "nested");
                return Map.of("ok", true);
            }
        };
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(publishedScript("child")), () -> scriptEngine);
        List<String> logs = new ArrayList<>();

        Object result = service.invokePublished(
                "child",
                new ScriptDefinition().setId("parent"),
                new ScriptExecutionContext()
                        .setScriptStack(List.of("parent"))
                        .setLogger((level, message) -> logs.add(level + ":" + message)),
                Map.of()
        );

        assertThat(result).isEqualTo(Map.of("ok", true));
        assertThat(logs).containsExactly("INFO:[script:child] nested");
    }

    @Test
    void invokePublishedRejectsUnpublishedScript() {
        ScriptDefinition draftOnly = new ScriptDefinition()
                .setId("draft-only")
                .setName("Draft")
                .setType(ScriptType.GROOVY)
                .setSource("draft");
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(draftOnly), RecordingScriptEngine::new);

        assertThatThrownBy(() -> service.invokePublished("draft-only", null, null, Map.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("调用脚本 draft-only 失败: 脚本未发布: draft-only");
    }

    @Test
    void invokePublishedResolvesRepositoryScriptDependencyBeforeLookup() {
        RecordingScriptEngine scriptEngine = new RecordingScriptEngine();
        ScriptDefinition child = publishedScript("repo.child-tool");
        child.setScope(org.team4u.actiondock.domain.model.ScriptScope.REPOSITORY)
                .setRepositoryId("repo")
                .setRepositoryToolId("child-tool")
                .setRepositoryVersion("1.0.0");
        ScriptInvocationService service = new ScriptInvocationService(repositoryWith(child), () -> scriptEngine);

        Object result = service.invokePublished(
                "child",
                new ScriptDefinition()
                        .setId("parent")
                        .setScriptDependencies(List.of(new ScriptDependency()
                                .setScriptId("child")
                                .setRepositoryId("repo")
                                .setToolId("child-tool")
                                .setVersionRange(">= 1.0.0"))),
                new ScriptExecutionContext().setScriptStack(List.of("parent")),
                Map.of()
        );

        assertThat(result).isEqualTo(Map.of("result", 42));
        assertThat(scriptEngine.lastContext.getScriptStack()).containsExactly("parent", "repo.child-tool");
    }

    private ScriptRepository repositoryWith(ScriptDefinition definition) {
        return new ScriptRepository() {
            @Override
            public ScriptDefinition save(ScriptDefinition ignored) {
                throw new UnsupportedOperationException("Not needed");
            }

            @Override
            public Optional<ScriptDefinition> findById(String id) {
                return definition.getId().equals(id) ? Optional.of(definition) : Optional.empty();
            }

            @Override
            public List<ScriptDefinition> findAll() {
                return List.of(definition);
            }

            @Override
            public void deleteById(String id) {
                throw new UnsupportedOperationException("Not needed");
            }
        };
    }

    private ScriptDefinition publishedScript(String id) {
        return new ScriptDefinition()
                .setId(id)
                .setName("Draft Name")
                .setType(ScriptType.PYTHON)
                .setSource("draft-source")
                .setInputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "name", Map.of("type", "string", "title", "Name")
                        )
                ))
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-" + id)
                        .setScriptId(id)
                        .setVersion(1)
                        .setPublishedAt(java.time.LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("Published Name")
                        .setType(ScriptType.GROOVY)
                        .setSource("published-source")
                        .setInputSchema(Map.of(
                                "type", "object",
                                "properties", Map.of(
                                        "name", Map.of("type", "string", "title", "Name")
                                )
                        ))
                        .setOutputSchema(Map.of("type", "object")));
    }

    private static class RecordingScriptEngine implements ScriptEngine {
        private ScriptDefinition lastDefinition;
        private Map<String, Object> lastInput;
        private ScriptExecutionContext lastContext;

        @Override
        public void validate(ScriptDefinition definition) {
        }

        @Override
        public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
            this.lastDefinition = definition;
            this.lastInput = input == null ? Map.of() : new LinkedHashMap<>(input);
            this.lastContext = executionContext;
            return 42;
        }
    }
}
