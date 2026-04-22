package org.team4u.scriptflow.domain.port;

@FunctionalInterface
public interface ScheduleExpressionValidator {
    void validate(String expression);
}
