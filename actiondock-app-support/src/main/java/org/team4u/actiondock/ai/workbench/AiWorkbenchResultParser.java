package org.team4u.actiondock.ai.workbench;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.ai.api.AiAgentRunResult;

import java.util.LinkedHashMap;
import java.util.Map;

class AiWorkbenchResultParser {
    private final ObjectMapper objectMapper;

    AiWorkbenchResultParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    Map<String, Object> extract(String resultKey, Map<String, Object> rawOutput, AiAgentRunResult runResult) {
        Map<String, Object> direct = objectValue(rawOutput == null ? null : rawOutput.get(resultKey));
        if (!direct.isEmpty()) {
            return direct;
        }
        direct = objectValue(rawOutput == null ? null : rawOutput.get("data"));
        if (!direct.isEmpty()) {
            Map<String, Object> wrapped = objectValue(direct.get(resultKey));
            if (!wrapped.isEmpty()) {
                return wrapped;
            }
        }
        Map<String, Object> fromText = parseJsonObject(rawOutput == null ? null : rawOutput.get("text"));
        direct = objectValue(fromText.get(resultKey));
        if (!direct.isEmpty()) {
            return direct;
        }
        if (runResult.steps() != null) {
            for (int i = runResult.steps().size() - 1; i >= 0; i--) {
                Map<String, Object> toolOutput = runResult.steps().get(i).toolOutput();
                direct = objectValue(toolOutput == null ? null : toolOutput.get(resultKey));
                if (!direct.isEmpty()) {
                    return direct;
                }
                Map<String, Object> proposal = objectValue(toolOutput == null ? null : toolOutput.get("proposal"));
                direct = objectValue(proposal.get(resultKey));
                if (!direct.isEmpty()) {
                    return direct;
                }
                direct = objectValue(proposal.get("payload"));
                if (!direct.isEmpty() && resultKey.equals(proposal.get("resultKey"))) {
                    return direct;
                }
            }
        }
        return Map.of();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> objectValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return new LinkedHashMap<>((Map<String, Object>) map);
        }
        return Map.of();
    }

    private Map<String, Object> parseJsonObject(Object value) {
        if (!(value instanceof String text) || text.isBlank()) {
            return Map.of();
        }
        String trimmed = text.trim();
        int start = trimmed.indexOf('{');
        int end = trimmed.lastIndexOf('}');
        if (start < 0 || end <= start) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(trimmed.substring(start, end + 1), new TypeReference<>() {});
        } catch (Exception ignored) {
            return Map.of();
        }
    }
}
