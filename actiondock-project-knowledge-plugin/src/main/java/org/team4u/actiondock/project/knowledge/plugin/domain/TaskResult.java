package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.Map;

public record TaskResult(
        String taskId,
        String taskType,
        String status,
        String rawOutput,
        Map<String, Object> parsedOutput,
        String parseError,
        String outputPath
) {
    public boolean done() {
        return "done".equals(status);
    }
}
