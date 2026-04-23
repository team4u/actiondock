package org.team4u.scriptflow.web;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 模式视图清洗器，移除 Schema 中的 UI 扩展字段（ui、x-ui）。
 *
 * @author jay.wu
 */
final class SchemaViewSanitizer {
    private SchemaViewSanitizer() {
    }

    static ScriptDefinition sanitize(ScriptDefinition definition) {
        return new ScriptDefinition()
                .setId(definition.getId())
                .setName(definition.getName())
                .setType(definition.getType())
                .setSource(definition.getSource())
                .setInputSchema(sanitizeSchema(definition.getInputSchema()))
                .setOutputSchema(sanitizeSchema(definition.getOutputSchema()))
                .setPublishedSnapshot(sanitizeSnapshot(definition.getPublishedSnapshot()))
                .setStatus(definition.getStatus())
                .setVersion(definition.getVersion())
                .setCreatedAt(definition.getCreatedAt())
                .setUpdatedAt(definition.getUpdatedAt());
    }

    static PublishedScriptSnapshot sanitizeSnapshot(PublishedScriptSnapshot snapshot) {
        if (snapshot == null) {
            return null;
        }
        return new PublishedScriptSnapshot()
                .setName(snapshot.getName())
                .setType(snapshot.getType())
                .setSource(snapshot.getSource())
                .setInputSchema(sanitizeSchema(snapshot.getInputSchema()))
                .setOutputSchema(sanitizeSchema(snapshot.getOutputSchema()));
    }

    static Map<String, Object> sanitizeSchema(Map<String, Object> schema) {
        if (schema == null || schema.isEmpty()) {
            return new LinkedHashMap<>();
        }
        Object sanitized = sanitizeValue(schema);
        if (sanitized instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, value) -> result.put(String.valueOf(key), value));
            return result;
        }
        return new LinkedHashMap<>();
    }

    private static Object sanitizeValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, item) -> {
                String fieldName = String.valueOf(key);
                if ("ui".equals(fieldName) || "x-ui".equals(fieldName)) {
                    return;
                }
                result.put(fieldName, sanitizeValue(item));
            });
            return result;
        }
        if (value instanceof List<?> list) {
            List<Object> result = new ArrayList<>(list.size());
            for (Object item : list) {
                result.add(sanitizeValue(item));
            }
            return List.copyOf(result);
        }
        return value;
    }
}
