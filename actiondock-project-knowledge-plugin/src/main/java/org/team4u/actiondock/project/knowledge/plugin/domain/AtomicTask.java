package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.List;
import java.util.Map;

public record AtomicTask(
        String id,
        String taskType,
        String title,
        String templateName,
        String outputPath,
        List<String> evidence,
        Map<String, Object> input
) {
}
