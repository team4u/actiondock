package org.team4u.actiondock.domain.model;

public record EventTriggerDispatchResult(
        EventDispatchRecord dispatch,
        ExecutionRecord execution,
        ScriptDefinition scriptDefinition
) {
}
