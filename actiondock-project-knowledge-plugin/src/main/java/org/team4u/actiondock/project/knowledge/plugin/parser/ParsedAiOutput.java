package org.team4u.actiondock.project.knowledge.plugin.parser;

import java.util.Map;

public record ParsedAiOutput(
        String status,
        String rawOutput,
        Map<String, Object> parsedOutput,
        String parseError
) {
    public static ParsedAiOutput done(String rawOutput, Map<String, Object> parsedOutput) {
        return new ParsedAiOutput("done", rawOutput, parsedOutput, null);
    }

    public static ParsedAiOutput needsReview(String rawOutput, String parseError, Map<String, Object> fallback) {
        return new ParsedAiOutput("needs_review", rawOutput, fallback, parseError);
    }

    public boolean parsed() {
        return "done".equals(status);
    }
}
