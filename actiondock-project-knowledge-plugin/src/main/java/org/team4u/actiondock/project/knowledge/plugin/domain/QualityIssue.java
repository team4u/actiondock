package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.util.Map;

public record QualityIssue(String code, String path, String message) {
    public Map<String, Object> toMap() {
        return Map.of("code", code, "path", path, "message", message);
    }
}
