package org.team4u.actiondock.web.script;

import org.team4u.actiondock.domain.model.ExecutionStatus;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 脚本调度视图，包含调度详情及最近执行状态。
 *
 * @author jay.wu
 */
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
