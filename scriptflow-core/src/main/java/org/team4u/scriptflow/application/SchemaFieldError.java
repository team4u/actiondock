package org.team4u.scriptflow.application;

public record SchemaFieldError(
        String field,
        String reason,
        String message,
        String expected,
        String actual
) {
}
