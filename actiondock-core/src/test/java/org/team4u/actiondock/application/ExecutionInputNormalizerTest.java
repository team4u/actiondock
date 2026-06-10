package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionInputNormalizerTest {
    @Test
    void normalizeMapConvertsNestedCharSequencesToStrings() {
        Map<String, Object> normalized = ExecutionInputNormalizer.normalizeMap(Map.of(
                "tableName", new StringBuilder("cap.cbs_table"),
                "nested", Map.of("schema", new StringBuffer("cap")),
                "items", List.of(new StringBuilder("a"), Map.of("name", new StringBuffer("b")))
        ));

        assertThat(normalized.get("tableName")).isEqualTo("cap.cbs_table").isInstanceOf(String.class);
        assertThat(((Map<?, ?>) normalized.get("nested")).get("schema")).isEqualTo("cap").isInstanceOf(String.class);
        assertThat(((List<?>) normalized.get("items")).get(0)).isEqualTo("a").isInstanceOf(String.class);
        assertThat(((Map<?, ?>) ((List<?>) normalized.get("items")).get(1)).get("name"))
                .isEqualTo("b")
                .isInstanceOf(String.class);
    }
}
