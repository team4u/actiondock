package org.team4u.actiondock.web.script;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import org.team4u.actiondock.web.common.InvalidScriptPatchException;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 脚本补丁服务，封装 JSON Merge Patch (RFC 7396) 对脚本定义的应用逻辑。
 *
 * @author jay.wu
 */
@Component
public class ScriptPatchService {

    private static final List<String> ALLOWED_PATCH_FIELDS = List.of("name", "description", "source", "pythonRequirements", "inputSchema", "outputSchema", "maxExecutionRecords");
    private static final Set<String> ALLOWED_PATCH_FIELD_SET = Set.copyOf(ALLOWED_PATCH_FIELDS);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ScriptApplicationService scriptApplicationService;
    private final ObjectMapper objectMapper;

    ScriptPatchService(ScriptApplicationService scriptApplicationService, ObjectMapper objectMapper) {
        this.scriptApplicationService = scriptApplicationService;
        this.objectMapper = objectMapper;
    }

    /**
     * 对指定脚本定义应用 JSON Merge Patch。
     * <p>
     * 仅允许补丁以下字段：name、description、source、pythonRequirements、inputSchema、outputSchema。
     * 对 schema 字段采用 RFC 7396 递归合并策略。
     *
     * @param id   脚本 ID
     * @param patch 补丁内容，键为字段名，值为目标值
     * @return 补丁应用后保存的脚本定义
     */
    public ScriptDefinition patch(String id, Map<String, Object> patch) {
        ScriptDefinition existing = scriptApplicationService.get(id);
        validatePatchFields(id, patch);

        ScriptDefinition updated = objectMapper.convertValue(existing, ScriptDefinition.class);
        Map<String, Object> safePatch = patch == null ? Map.of() : patch;
        if (safePatch.containsKey("name")) {
            applyNamePatch(updated, safePatch.get("name"));
        }
        if (safePatch.containsKey("description")) {
            applyDescriptionPatch(updated, safePatch.get("description"));
        }
        if (safePatch.containsKey("source")) {
            applySourcePatch(updated, safePatch.get("source"));
        }
        if (safePatch.containsKey("pythonRequirements")) {
            applyPythonRequirementsPatch(updated, safePatch.get("pythonRequirements"));
        }
        if (safePatch.containsKey("inputSchema")) {
            updated.setInputSchema(applySchemaPatch(existing.getInputSchema(), safePatch.get("inputSchema"), "inputSchema"));
        }
        if (safePatch.containsKey("outputSchema")) {
            updated.setOutputSchema(applySchemaPatch(existing.getOutputSchema(), safePatch.get("outputSchema"), "outputSchema"));
        }
        if (safePatch.containsKey("maxExecutionRecords")) {
            applyMaxExecutionRecordsPatch(updated, safePatch.get("maxExecutionRecords"));
        }
        return scriptApplicationService.save(updated);
    }

    private void validatePatchFields(String scriptId, Map<String, Object> patch) {
        if (patch == null || patch.isEmpty()) {
            return;
        }
        List<String> rejectedFields = patch.keySet().stream()
                .filter(field -> !ALLOWED_PATCH_FIELD_SET.contains(field))
                .sorted()
                .toList();
        if (!rejectedFields.isEmpty()) {
            throw new InvalidScriptPatchException(scriptId, rejectedFields, ALLOWED_PATCH_FIELDS);
        }
    }

    private void applyNamePatch(ScriptDefinition definition, Object value) {
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("name 必须是非空字符串");
        }
        definition.setName(text.trim());
    }

    private void applyDescriptionPatch(ScriptDefinition definition, Object value) {
        if (!(value instanceof String text)) {
            throw new IllegalArgumentException("description 必须是字符串");
        }
        definition.setDescription(text.trim());
    }

    private void applySourcePatch(ScriptDefinition definition, Object value) {
        if (value != null && !(value instanceof String)) {
            throw new IllegalArgumentException("source 必须是字符串或 null");
        }
        definition.setSource((String) value);
    }

    private void applyPythonRequirementsPatch(ScriptDefinition definition, Object value) {
        if (value != null && !(value instanceof String)) {
            throw new IllegalArgumentException("pythonRequirements 必须是字符串 or null");
        }
        definition.setPythonRequirements((String) value);
    }

    private void applyMaxExecutionRecordsPatch(ScriptDefinition definition, Object value) {
        if (value == null) {
            definition.setMaxExecutionRecords(1000);
            return;
        }
        if (!(value instanceof Number number)) {
            throw new IllegalArgumentException("maxExecutionRecords 必须是数字");
        }
        definition.setMaxExecutionRecords(number.intValue());
    }

    private Map<String, Object> applySchemaPatch(Map<String, Object> currentValue, Object patchValue, String fieldName) {
        if (patchValue == null) {
            return Map.of();
        }
        JsonNode patchNode = objectMapper.valueToTree(patchValue);
        if (!patchNode.isObject()) {
            throw new IllegalArgumentException(fieldName + " 必须是对象或 null");
        }
        JsonNode currentNode = objectMapper.valueToTree(currentValue == null ? Map.of() : currentValue);
        JsonNode mergedNode = applyMergePatch(currentNode, patchNode);
        Map<String, Object> merged = objectMapper.convertValue(mergedNode, MAP_TYPE);
        return merged == null ? Map.of() : merged;
    }

    private JsonNode applyMergePatch(JsonNode target, JsonNode patch) {
        if (patch == null || patch.isNull()) {
            return objectMapper.nullNode();
        }
        if (!patch.isObject()) {
            return patch.deepCopy();
        }

        JsonNode normalizedTarget = target != null && target.isObject()
                ? target.deepCopy()
                : objectMapper.createObjectNode();
        com.fasterxml.jackson.databind.node.ObjectNode result = (com.fasterxml.jackson.databind.node.ObjectNode) normalizedTarget;
        patch.fields().forEachRemaining(entry -> {
            String fieldName = entry.getKey();
            JsonNode patchValue = entry.getValue();
            if (patchValue == null || patchValue.isNull()) {
                result.remove(fieldName);
                return;
            }
            JsonNode targetValue = result.get(fieldName);
            result.set(fieldName, applyMergePatch(targetValue, patchValue));
        });
        return result;
    }
}
