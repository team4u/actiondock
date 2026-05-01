package org.team4u.actiondock.web;

import org.team4u.actiondock.application.SchemaFieldError;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;

import java.util.List;
import java.util.Map;

public record ProcessorTestResultView(
        boolean success,
        Map<String, Object> output,
        String errorMessage,
        List<ExecutionLogEntry> logs,
        Long durationMs,
        boolean schemaValid,
        List<SchemaFieldError> fieldErrors
) {
}
