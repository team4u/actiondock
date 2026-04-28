package org.team4u.actiondock.script;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SharedStateEntry;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.SharedStateRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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

    @Test
    void executeExposesStateBinding() {
        PythonScriptEngine stateEngine = new PythonScriptEngine(
                jsonCodec,
                pythonProperties(30),
                ScriptInvocationService.disabled(),
                new SharedStateApplicationService(new InMemorySharedStateRepository())
        );

        Object result = stateEngine.execute(
                new ScriptDefinition()
                        .setId("state-script")
                        .setSource("""
                                saved = state.put("oauth.github", "token", {"accessToken": input.get("token")}, {"secret": True, "ttlSeconds": 60})
                                loaded = state.get("oauth.github", "token")
                                return {"savedVersion": saved.get("version"), "loadedValue": loaded.get("value").get("accessToken"), "secret": loaded.get("secret")}
                                """),
                Map.of("token", "abc"),
                new ScriptExecutionContext().setExecutionId("exec-1")
        );

        assertThat(result).isEqualTo(Map.of(
                "savedVersion", 1,
                "loadedValue", "abc",
                "secret", true
        ));
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

    private static final class InMemorySharedStateRepository implements SharedStateRepository {
        private final Map<String, SharedStateEntry> values = new LinkedHashMap<>();

        @Override
        public SharedStateEntry save(SharedStateEntry entry) {
            SharedStateEntry copy = copy(entry);
            values.put(id(entry.getNamespace(), entry.getKey()), copy);
            return copy(copy);
        }

        @Override
        public Optional<SharedStateEntry> findByNamespaceAndKey(String namespace, String key) {
            return Optional.ofNullable(values.get(id(namespace, key))).map(InMemorySharedStateRepository::copy);
        }

        @Override
        public List<SharedStateEntry> findByNamespace(String namespace) {
            return values.values().stream()
                    .filter(item -> namespace.equals(item.getNamespace()))
                    .map(InMemorySharedStateRepository::copy)
                    .toList();
        }

        @Override
        public List<SharedStateEntry> findAll() {
            return values.values().stream().map(InMemorySharedStateRepository::copy).toList();
        }

        @Override
        public boolean compareAndSet(SharedStateEntry entry, Long expectedVersion) {
            String id = id(entry.getNamespace(), entry.getKey());
            SharedStateEntry current = values.get(id);
            if (current == null || !Objects.equals(current.getVersion(), expectedVersion)) {
                return false;
            }
            values.put(id, copy(entry));
            return true;
        }

        @Override
        public void deleteByNamespaceAndKey(String namespace, String key) {
            values.remove(id(namespace, key));
        }

        @Override
        public long deleteExpired(LocalDateTime now) {
            return 0;
        }

        @Override
        public long deleteExpired(String namespace, LocalDateTime now) {
            return 0;
        }

        private static String id(String namespace, String key) {
            return namespace + "\u0000" + key;
        }

        private static SharedStateEntry copy(SharedStateEntry source) {
            return new SharedStateEntry()
                    .setNamespace(source.getNamespace())
                    .setKey(source.getKey())
                    .setValue(source.getValue())
                    .setSecret(source.isSecret())
                    .setVersion(source.getVersion())
                    .setExpiresAt(source.getExpiresAt())
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt())
                    .setLastWriterScriptId(source.getLastWriterScriptId())
                    .setLastWriterExecutionId(source.getLastWriterExecutionId());
        }
    }
}
