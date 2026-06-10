package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionOutputProjectorTest {

    @Test
    void projectKeepsOnlySchemaDeclaredFields() {
        Map<String, Object> rawOutput = new LinkedHashMap<>();
        rawOutput.put("message", "Hello");
        rawOutput.put("secret", "token");
        rawOutput.put("count", 3);
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("message", Map.of("type", "string"));
        properties.put("count", Map.of("type", "integer"));
        Map<String, Object> expected = new LinkedHashMap<>();
        expected.put("message", "Hello");
        expected.put("count", 3);

        Map<String, Object> projected = ExecutionOutputProjector.project(
                rawOutput,
                Map.of(
                        "type", "object",
                        "properties", properties
                )
        );

        assertThat(projected).containsExactlyEntriesOf(expected);
    }

    @Test
    void projectFallsBackToRawOutputWhenSchemaHasNoProperties() {
        Map<String, Object> rawOutput = new LinkedHashMap<>(Map.of("message", "Hello", "secret", "token"));

        Map<String, Object> projected = ExecutionOutputProjector.project(rawOutput, Map.of("type", "object"));

        assertThat(projected).containsExactlyEntriesOf(rawOutput);
        assertThat(projected).isNotSameAs(rawOutput);
    }

    @Test
    void projectReturnsEmptyWhenSchemaPropertiesDoNotMatchRawOutput() {
        Map<String, Object> projected = ExecutionOutputProjector.project(
                Map.of("secret", "token"),
                Map.of("properties", Map.of("message", Map.of("type", "string")))
        );

        assertThat(projected).isEmpty();
    }
}
