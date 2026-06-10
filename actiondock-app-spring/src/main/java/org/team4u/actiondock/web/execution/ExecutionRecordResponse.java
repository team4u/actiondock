package org.team4u.actiondock.web.execution;

import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.domain.model.SubmitMode;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 执行记录响应，保留历史详情所需输入，并按脚本输出 Schema 返回投影后的输出。
 */
public record ExecutionRecordResponse(
        String id,
        String scriptId,
        ExecutionStatus status,
        SubmitMode submitMode,
        ExecutionTriggerSource triggerSource,
        String scheduleId,
        String agentRunId,
        String agentStepId,
        String webhookId,
        Map<String, Object> input,
        Map<String, Object> output,
        List<ExecutionLogEntry> logs,
        String errorMessage,
        ErrorDetail errorDetail,
        LocalDateTime createdAt,
        LocalDateTime startedAt,
        LocalDateTime finishedAt
) {
}
