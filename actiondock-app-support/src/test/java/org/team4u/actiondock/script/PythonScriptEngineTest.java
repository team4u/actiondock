package org.team4u.actiondock.script;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PythonScriptEngineTest {
    private final JsonCodec jsonCodec = new TestJsonCodec();
    private final PythonScriptEngine engine = new PythonScriptEngine(jsonCodec, pythonProperties(30));

    @Test
    void validateAcceptsCompilableScripts() {
        assertThatCode(() -> engine.validate(new ScriptDefinition().setSource("return {\"message\": \"ok\"}")))
                .doesNotThrowAnyException();
    }

    @Test
    void validateRejectsInvalidPythonSource() {
        assertThatThrownBy(() -> engine.validate(new ScriptDefinition().setSource("return {")))
                .isInstanceOf(Exception.class);
    }

    @Test
    void executeEvaluatesScriptAgainstInputMap() {
        Object result = engine.execute(
                new ScriptDefinition().setSource("name = input.get(\"name\") or \"World\"\nreturn {\"message\": f\"Hello, {name}\"}"),
                Map.of("name", "Alice"),
                null
        );

        assertThat(result).isEqualTo(Map.of("message", "Hello, Alice"));
    }

    @Test
    void executeReturnsJsonArraysAndScalars() {
        Object listResult = engine.execute(new ScriptDefinition().setSource("return [1, 2, 3]"), null, null);
        Object scalarResult = engine.execute(new ScriptDefinition().setSource("return True"), null, null);

        assertThat(listResult).isEqualTo(List.of(1, 2, 3));
        assertThat(scalarResult).isEqualTo(true);
    }

    @Test
    void executeRejectsNonJsonSerializableResults() {
        assertThatThrownBy(() -> engine.execute(
                new ScriptDefinition().setSource("return {\"bad\": {1, 2}}"),
                null,
                null
        ))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("not JSON serializable");
    }

    @Test
    void executeFailsWhenScriptTimesOut() {
        PythonScriptEngine timeoutEngine = new PythonScriptEngine(
                jsonCodec,
                pythonProperties(1)
        );

        assertThatThrownBy(() -> timeoutEngine.execute(
                new ScriptDefinition().setSource("import time\ntime.sleep(2)\nreturn {\"ok\": True}"),
                null,
                new ScriptExecutionContext()
        ))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Python 脚本执行超时");
    }

    @Test
    void executeStreamsLogsThroughInjectedLogger() {
        List<String> logs = new ArrayList<>();
        ScriptExecutionContext context = new ScriptExecutionContext()
                .setLogger((level, message) -> logs.add(level + ":" + message));

        Object result = engine.execute(
                new ScriptDefinition().setSource("""
                        log.info("hello")
                        log.error(input.get("name"))
                        return {"ok": True}
                        """),
                Map.of("name", "Alice"),
                context
        );

        assertThat(result).isEqualTo(Map.of("ok", true));
        assertThat(logs).containsExactly(
                ExecutionLogLevel.INFO + ":hello",
                ExecutionLogLevel.ERROR + ":Alice"
        );
    }

    @Test
    void executeExposesConfigBinding() {
        ScriptExecutionContext context = new ScriptExecutionContext()
                .setConfig(Map.of("api_key", "secret-value"));

        Object result = engine.execute(
                new ScriptDefinition().setSource("return {\"apiKey\": config.get(\"api_key\")}"),
                Map.of(),
                context
        );

        assertThat(result).isEqualTo(Map.of("apiKey", "secret-value"));
    }

    @Test
    void executeExposesScriptsBinding() {
        PythonScriptEngine invocationEngine = new PythonScriptEngine(
                jsonCodec,
                pythonProperties(30),
                invocationService()
        );

        Object result = invocationEngine.execute(
                new ScriptDefinition()
                        .setId("parent")
                        .setSource("return scripts.invoke(\"child\", {\"name\": input.get(\"name\")})"),
                Map.of("name", "Alice"),
                new ScriptExecutionContext().setScriptStack(List.of("parent"))
        );

        assertThat(result).isEqualTo(Map.of("message", "Hello, Alice"));
    }

    private static AppProperties.Python pythonProperties(int timeoutSeconds) {
        AppProperties.Python properties = new AppProperties.Python();
        properties.setExecutable("python3");
        properties.setTimeoutSeconds(timeoutSeconds);
        return properties;
    }

    private static ScriptInvocationService invocationService() {
        ScriptDefinition child = new ScriptDefinition()
                .setId("child")
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Child")
                        .setType(ScriptType.GROOVY)
                        .setSource("return {:}")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")));
        ScriptRepository repository = new ScriptRepository() {
            @Override
            public ScriptDefinition save(ScriptDefinition definition) {
                throw new UnsupportedOperationException("Not needed");
            }

            @Override
            public Optional<ScriptDefinition> findById(String id) {
                return "child".equals(id) ? Optional.of(child) : Optional.empty();
            }

            @Override
            public List<ScriptDefinition> findAll() {
                return List.of(child);
            }

            @Override
            public void deleteById(String id) {
                throw new UnsupportedOperationException("Not needed");
            }
        };
        ScriptEngine nestedEngine = new ScriptEngine() {
            @Override
            public void validate(ScriptDefinition definition) {
            }

            @Override
            public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
                return Map.of("message", "Hello, " + input.get("name"));
            }
        };
        return new ScriptInvocationService(repository, () -> nestedEngine);
    }

    private static final class TestJsonCodec implements JsonCodec {
        private final ObjectMapper objectMapper = new ObjectMapper();

        @Override
        public String write(Object value) {
            try {
                return value == null ? null : objectMapper.writeValueAsString(value);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot serialize value", e);
            }
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            try {
                return json == null || json.isBlank() ? null : objectMapper.readValue(json, type);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize value", e);
            }
        }

        @Override
        public Object readUntyped(String json) {
            try {
                return json == null || json.isBlank() ? null : objectMapper.readValue(json, Object.class);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize value", e);
            }
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            throw new UnsupportedOperationException("Not needed for this test");
        }

        @Override
        public Map<String, Object> readMap(String json) {
            try {
                return json == null || json.isBlank() ? Map.of() : objectMapper.readValue(json, Map.class);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize map", e);
            }
        }
    }
}
