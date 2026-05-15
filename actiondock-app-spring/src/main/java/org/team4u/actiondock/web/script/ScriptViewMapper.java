package org.team4u.actiondock.web.script;

import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本 API 视图映射器。
 */
public final class ScriptViewMapper {

    private ScriptViewMapper() {
    }

    public static ScriptDocumentView toView(ScriptDefinition source, boolean includeUiSchema) {
        Map<String, Object> inputSchema = schema(source.getInputSchema(), includeUiSchema);
        Map<String, Object> outputSchema = schema(source.getOutputSchema(), includeUiSchema);
        ScriptPublishedRevisionView published = toPublishedView(source.getPublishedRevision(), includeUiSchema);
        return new ScriptDocumentView(
                source.getId(),
                source.getName(),
                source.getType(),
                source.getPackaging(),
                source.getSource(),
                source.getPythonRequirements(),
                inputSchema,
                outputSchema,
                source.getVersion(),
                source.getScope(),
                source.getRepositoryId(),
                source.getRepositoryScriptId(),
                source.getRepositoryVersion(),
                source.getSourcePath(),
                source.getSourceCommit(),
                source.getSourceDigest(),
                source.getSourceSyncedAt(),
                source.isDirty(),
                source.isEditable(),
                source.getOwner(),
                source.getDescription(),
                source.getTags(),
                source.getScriptDependencies(),
                source.getPluginDependencies(),
                source.getAiDependencies(),
                published,
                new ScriptPublicationView(
                        source.hasPublishedRevision(),
                        source.hasUnpublishedChanges(),
                        source.hasPublishedRevision() ? source.getVersion() : null,
                        source.getPublishedAt()
                ),
                source.getCreatedAt(),
                source.getUpdatedAt()
        );
    }

    public static ScriptPublishedRevisionView toPublishedView(ScriptDefinition source, boolean includeUiSchema) {
        return toPublishedView(source.getPublishedRevision(), includeUiSchema);
    }

    public static ScriptPublishedRevisionView toPublishedView(PublishedScriptRevision revision, boolean includeUiSchema) {
        if (revision == null) {
            return null;
        }
        return new ScriptPublishedRevisionView(
                revision.getScriptId(),
                revision.getId(),
                revision.getVersion(),
                revision.getPublishedAt(),
                revision.getName(),
                revision.getType(),
                revision.getPackaging(),
                revision.getSource(),
                revision.getPythonRequirements(),
                schema(revision.getInputSchema(), includeUiSchema),
                schema(revision.getOutputSchema(), includeUiSchema),
                revision.getOwner(),
                revision.getDescription(),
                revision.getTags(),
                revision.getScriptDependencies(),
                revision.getPluginDependencies(),
                revision.getAiDependencies()
        );
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

    private static Map<String, Object> schema(Map<String, Object> schema, boolean includeUiSchema) {
        return includeUiSchema ? new LinkedHashMap<>(schema) : sanitizeSchema(schema);
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
