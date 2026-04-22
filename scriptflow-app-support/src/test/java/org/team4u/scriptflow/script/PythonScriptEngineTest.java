package org.team4u.scriptflow.script;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.port.JsonCodec;

import java.util.List;
import java.util.Map;

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

    private static AppProperties.Python pythonProperties(int timeoutSeconds) {
        AppProperties.Python properties = new AppProperties.Python();
        properties.setExecutable("python3");
        properties.setTimeoutSeconds(timeoutSeconds);
        return properties;
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
            throw new UnsupportedOperationException("Not needed for this test");
        }
    }
}
