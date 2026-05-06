package org.team4u.actiondock.web;

import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本视图映射器，负责将实体转换为 API 响应所需的格式。
 *
 * @author jay.wu
 */
public final class ScriptViewMapper {

    private ScriptViewMapper() {
    }

    /**
     * 创建去除 UI 扩展字段的脚本定义副本，用于 API 响应。
     */
    public static ScriptDefinition withoutUiSchema(ScriptDefinition source) {
        PublishedScriptSnapshot sanitizedSnapshot = sanitizeSnapshot(source.getPublishedSnapshot());
        return new ScriptDefinition()
                .setName(source.getName())
                .setType(source.getType())
                .setSource(source.getSource())
                .setPythonRequirements(source.getPythonRequirements())
                .setPackaging(source.getPackaging())
                .setInputSchema(sanitizeSchema(source.getInputSchema()))
                .setOutputSchema(sanitizeSchema(source.getOutputSchema()))
                .setPublishedSnapshot(sanitizedSnapshot)
                .setStatus(source.getStatus())
                .setVersion(source.getVersion())
                .setScriptDependencies(source.getScriptDependencies())
                .setAiDependencies(source.getAiDependencies())
                .setId(source.getId())
                .setScope(source.getScope())
                .setRepositoryId(source.getRepositoryId())
                .setRepositoryToolId(source.getRepositoryToolId())
                .setRepositoryVersion(source.getRepositoryVersion())
                .setSourcePath(source.getSourcePath())
                .setSourceCommit(source.getSourceCommit())
                .setSourceDigest(source.getSourceDigest())
                .setSourceSyncedAt(source.getSourceSyncedAt())
                .setDirty(source.isDirty())
                .setEditable(source.isEditable())
                .setOwner(source.getOwner())
                .setDescription(source.getDescription())
                .setTags(source.getTags())
                .setPluginDependencies(source.getPluginDependencies())
                .setCreatedAt(source.getCreatedAt())
                .setUpdatedAt(source.getUpdatedAt());
    }

    private static PublishedScriptSnapshot sanitizeSnapshot(PublishedScriptSnapshot snapshot) {
        if (snapshot == null) {
            return null;
        }
        return new PublishedScriptSnapshot()
                .setName(snapshot.getName())
                .setType(snapshot.getType())
                .setPackaging(snapshot.getPackaging())
                .setSource(snapshot.getSource())
                .setPythonRequirements(snapshot.getPythonRequirements())
                .setInputSchema(sanitizeSchema(snapshot.getInputSchema()))
                .setOutputSchema(sanitizeSchema(snapshot.getOutputSchema()))
                .setScriptDependencies(snapshot.getScriptDependencies())
                .setAiDependencies(snapshot.getAiDependencies());
    }

    /**
     * 清洗 Schema Map，递归移除 UI 扩展字段（ui、x-ui）。
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
