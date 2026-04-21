package org.team4u.scriptflow.web;

import org.team4u.scriptflow.application.SchemaFieldError;

import java.util.List;

public record ValidationErrorResponse(
        String code,
        String scriptId,
        List<SchemaFieldError> fieldErrors
) {
}
