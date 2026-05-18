package org.team4u.actiondock.web.execution;

import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.SubmitMode;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 脚本执行结果响应，包含执行状态、输出和可选的调试信息。
 *
 * @author jay.wu
 */
public record ExecutionResponse(
        String id,
        String scriptId,
        ExecutionStatus status,
        SubmitMode submitMode,
        ExecutionTriggerSource triggerSource,
        String scheduleId,
        String agentRunId,
        String agentStepId,
        String webhookId,
        Map<String, Object> output,
        List<ExecutionLogEntry> logs,
        String errorMessage,
        ErrorDetail errorDetail,
        LocalDateTime createdAt,
        LocalDateTime startedAt,
        LocalDateTime finishedAt,
        DebugPayload debug
) {
    public record DebugPayload(
            Map<String, Object> input,
            Map<String, Object> rawOutput
    ) {
    }
}
