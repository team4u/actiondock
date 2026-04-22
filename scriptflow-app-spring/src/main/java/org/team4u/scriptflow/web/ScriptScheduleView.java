package org.team4u.scriptflow.web;

import org.team4u.scriptflow.domain.model.ExecutionStatus;

import java.time.LocalDateTime;
import java.util.Map;

public record ScriptScheduleView(
        String id,
        String scriptId,
        String name,
        String cronExpression,
        Map<String, Object> input,
        boolean enabled,
        LocalDateTime nextRunAt,
        LocalDateTime lastTriggeredAt,
        String lastExecutionId,
        ExecutionStatus lastExecutionStatus,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
