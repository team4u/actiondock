package org.team4u.actiondock.web;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;

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

    /**
     * 清洗脚本定义中的 UI 扩展字段。
     * <p>
     * 移除输入输出 Schema 中的 ui、x-ui 字段，生成不包含 UI 信息的脚本定义副本。
     *
     * @param definition 原始脚本定义
     * @return 清洗后的脚本定义
     */
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
                .setScope(definition.getScope())
                .setRepositoryId(definition.getRepositoryId())
                .setRepositoryToolId(definition.getRepositoryToolId())
                .setRepositoryVersion(definition.getRepositoryVersion())
                .setEditable(definition.isEditable())
                .setOwner(definition.getOwner())
                .setDescription(definition.getDescription())
                .setTags(definition.getTags())
                .setCreatedAt(definition.getCreatedAt())
                .setUpdatedAt(definition.getUpdatedAt());
    }

    /**
     * 清洗已发布快照中的 UI 扩展字段。
     *
     * @param snapshot 已发布快照，为 null 时返回 null
     * @return 清洗后的快照
     */
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

    /**
     * 递归清洗 Schema Map 中的 ui 和 x-ui 字段。
     *
     * @param schema 原始 Schema，为 null 或空时返回空 Map
     * @return 清洗后的 Schema Map
     */
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
