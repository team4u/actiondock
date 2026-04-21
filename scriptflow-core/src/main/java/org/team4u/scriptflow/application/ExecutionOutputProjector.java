package org.team4u.scriptflow.application;

import java.util.LinkedHashMap;
import java.util.Map;

public class ExecutionOutputProjector {
    public Map<String, Object> project(Map<String, Object> rawOutput, Map<String, Object> outputSchema) {
        Map<String, Object> source = rawOutput == null ? new LinkedHashMap<>() : new LinkedHashMap<>(rawOutput);
        Map<String, Object> properties = propertiesOf(outputSchema);
        if (properties.isEmpty()) {
            return source;
        }

        Map<String, Object> projected = new LinkedHashMap<>();
        properties.forEach((name, ignored) -> {
            if (source.containsKey(name)) {
                projected.put(name, source.get(name));
            }
        });
        return projected;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> propertiesOf(Map<String, Object> outputSchema) {
        if (outputSchema == null || outputSchema.isEmpty()) {
            return Map.of();
        }

        Object properties = outputSchema.get("properties");
        if (!(properties instanceof Map<?, ?> propertyMap) || propertyMap.isEmpty()) {
            return Map.of();
        }

        Map<String, Object> values = new LinkedHashMap<>();
        propertyMap.forEach((key, value) -> values.put(String.valueOf(key), value));
        return values;
    }
}
