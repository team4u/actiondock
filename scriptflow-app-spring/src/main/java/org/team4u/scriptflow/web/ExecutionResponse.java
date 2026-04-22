package org.team4u.scriptflow.web;

import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ErrorDetail;
import org.team4u.scriptflow.domain.model.SubmitMode;

import java.time.LocalDateTime;
import java.util.Map;

public record ExecutionResponse(
        String id,
        String scriptId,
        ExecutionStatus status,
        SubmitMode submitMode,
        Map<String, Object> output,
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
