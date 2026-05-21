package org.team4u.actiondock.project.knowledge.plugin.parser;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;

import java.util.LinkedHashMap;
import java.util.Map;

public class AiOutputParser {

    public ParsedAiOutput parse(String rawOutput) {
        String raw = rawOutput == null ? "" : rawOutput.trim();
        if (raw.isEmpty()) {
            return ParsedAiOutput.needsReview(rawOutput, "empty-output", Map.of("text", ""));
        }

        ParsedAiOutput direct = tryParse(raw, rawOutput, null);
        if (direct.parsed()) {
            return direct;
        }

        String fenced = fencedJson(raw);
        if (fenced != null) {
            ParsedAiOutput parsed = tryParse(fenced, rawOutput, "fenced-json-parse-failed");
            if (parsed.parsed()) {
                return parsed;
            }
        }

        String fragment = jsonFragment(raw);
        if (fragment != null) {
            ParsedAiOutput parsed = tryParse(fragment, rawOutput, "json-fragment-parse-failed");
            if (parsed.parsed()) {
                return parsed;
            }
        }

        Map<String, Object> fallback = new LinkedHashMap<>();
        fallback.put("text", rawOutput == null ? "" : rawOutput);
        fallback.put("format", "plain-text");
        return ParsedAiOutput.needsReview(rawOutput, "not-json", fallback);
    }

    @SuppressWarnings("unchecked")
    private ParsedAiOutput tryParse(String candidate, String rawOutput, String errorCode) {
        try {
            Object parsed = PluginObjectMappers.DEFAULT.readValue(candidate, Object.class);
            if (parsed instanceof Map<?, ?> map) {
                return ParsedAiOutput.done(rawOutput, (Map<String, Object>) map);
            }
            Map<String, Object> wrapped = new LinkedHashMap<>();
            wrapped.put("items", parsed);
            return ParsedAiOutput.done(rawOutput, wrapped);
        } catch (Exception exception) {
            return ParsedAiOutput.needsReview(rawOutput, errorCode == null ? exception.getMessage() : errorCode, Map.of());
        }
    }

    private static String fencedJson(String raw) {
        int fence = raw.indexOf("```");
        while (fence >= 0) {
            int contentStart = raw.indexOf('\n', fence + 3);
            if (contentStart < 0) {
                return null;
            }
            String info = raw.substring(fence + 3, contentStart).trim();
            int end = raw.indexOf("```", contentStart + 1);
            if (end < 0) {
                return null;
            }
            if (info.isEmpty() || info.equalsIgnoreCase("json")) {
                return raw.substring(contentStart + 1, end).trim();
            }
            fence = raw.indexOf("```", end + 3);
        }
        return null;
    }

    private static String jsonFragment(String raw) {
        int objectStart = raw.indexOf('{');
        int arrayStart = raw.indexOf('[');
        int start;
        char close;
        if (objectStart < 0 && arrayStart < 0) {
            return null;
        }
        if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
            start = arrayStart;
            close = ']';
        } else {
            start = objectStart;
            close = '}';
        }
        int end = raw.lastIndexOf(close);
        if (end <= start) {
            return null;
        }
        return raw.substring(start, end + 1);
    }
}
