package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.Map;

public interface ScriptEngine {
    void validate(ScriptDefinition definition);

    Object execute(ScriptDefinition definition, Map<String, Object> input);
}
