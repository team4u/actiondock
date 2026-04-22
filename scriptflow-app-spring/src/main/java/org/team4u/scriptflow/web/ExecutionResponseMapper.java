package org.team4u.scriptflow.web;

import org.team4u.scriptflow.application.ExecutionOutputProjector;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionLogEntry;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class ExecutionResponseMapper {
    private final ExecutionOutputProjector executionOutputProjector = new ExecutionOutputProjector();

    ExecutionResponse toResponse(ExecutionRecord record,
                                 ScriptDefinition scriptDefinition,
                                 ExecutionResponseView responseView) {
        Map<String, Object> rawOutput = copy(record.getOutput());
        ExecutionResponse.DebugPayload debugPayload = responseView == ExecutionResponseView.DEBUG
                ? new ExecutionResponse.DebugPayload(copy(record.getInput()), rawOutput)
                : null;
        return new ExecutionResponse(
                record.getId(),
                record.getScriptId(),
                record.getStatus(),
                record.getSubmitMode(),
                record.getTriggerSource(),
                record.getScheduleId(),
                executionOutputProjector.project(rawOutput, scriptDefinition.getOutputSchema()),
                copyLogs(record.getLogs()),
                record.getErrorMessage(),
                record.getErrorDetail(),
                record.getCreatedAt(),
                record.getStartedAt(),
                record.getFinishedAt(),
                debugPayload
        );
    }

    private Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value);
    }

    private List<ExecutionLogEntry> copyLogs(List<ExecutionLogEntry> value) {
        return value == null ? List.of() : List.copyOf(value);
    }
}
