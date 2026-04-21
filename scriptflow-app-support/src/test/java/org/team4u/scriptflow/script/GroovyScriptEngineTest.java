package org.team4u.scriptflow.script;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GroovyScriptEngineTest {
    private final GroovyScriptEngine engine = new GroovyScriptEngine();

    @Test
    void validateAcceptsCompilableScripts() {
        assertThatCode(() -> engine.validate(new ScriptDefinition().setSource("return [message: 'ok']")))
                .doesNotThrowAnyException();
    }

    @Test
    void validateRejectsInvalidGroovySource() {
        assertThatThrownBy(() -> engine.validate(new ScriptDefinition().setSource("return [")))
                .isInstanceOf(Exception.class);
    }

    @Test
    void executeEvaluatesScriptAgainstInputMap() {
        Object result = engine.execute(new ScriptDefinition().setSource("return [message: 'Hello, ' + input.name]"), Map.of("name", "Alice"));

        assertThat(result).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> values = (Map<String, Object>) result;
        assertThat(values).containsEntry("message", "Hello, Alice");
    }

    @Test
    void executeUsesEmptyInputWhenNullPayloadProvided() {
        Object result = engine.execute(new ScriptDefinition().setSource("return input.isEmpty()"), null);

        assertThat(result).isEqualTo(true);
    }
}
