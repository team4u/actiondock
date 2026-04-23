package org.team4u.scriptflow.plugin.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;

public final class PluginConfigBinder {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private PluginConfigBinder() {
    }

    /**
     * Binds a plugin config map to a Java type using Jackson deserialization only.
     * Platform-level defaults must already be applied by the caller before invoking this method.
     */
    public static <T> T bind(Map<String, Object> source, Class<T> type) {
        if (type == null) {
            throw new IllegalArgumentException("type must not be null");
        }

        try {
            return OBJECT_MAPPER.readValue(
                    OBJECT_MAPPER.writeValueAsString(source == null ? Collections.emptyMap() : source),
                    type
            );
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException(buildBindingErrorMessage(type, exception), exception);
        }
    }

    private static String buildBindingErrorMessage(Class<?> type, JsonProcessingException exception) {
        if (exception instanceof JsonMappingException mappingException) {
            String path = mappingException.getPath().stream()
                    .map(reference -> {
                        if (reference.getFieldName() != null) {
                            return reference.getFieldName();
                        }
                        if (reference.getIndex() >= 0) {
                            return "[" + reference.getIndex() + "]";
                        }
                        return null;
                    })
                    .filter(segment -> segment != null && !segment.isBlank())
                    .collect(Collectors.joining("."));
            if (!path.isBlank()) {
                return "Cannot bind plugin config to " + type.getName() + " at " + path + ": "
                        + mappingException.getOriginalMessage();
            }
        }
        return "Cannot bind plugin config to " + type.getName() + ": " + exception.getOriginalMessage();
    }
}
