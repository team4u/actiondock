package org.team4u.scriptflow.script;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.domain.port.ScriptEngine;

import java.util.EnumMap;
import java.util.Map;

public class RoutingScriptEngine implements ScriptEngine {
    private final Map<ScriptType, ScriptEngine> delegates = new EnumMap<>(ScriptType.class);

    public RoutingScriptEngine(ScriptEngine groovyScriptEngine, ScriptEngine pythonScriptEngine) {
        delegates.put(ScriptType.GROOVY, groovyScriptEngine);
        delegates.put(ScriptType.PYTHON, pythonScriptEngine);
    }

    @Override
    public void validate(ScriptDefinition definition) {
        resolve(definition).validate(definition);
    }

    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input) {
        return resolve(definition).execute(definition, input);
    }

    private ScriptEngine resolve(ScriptDefinition definition) {
        ScriptType type = definition.getType() == null ? ScriptType.GROOVY : definition.getType();
        ScriptEngine delegate = delegates.get(type);
        if (delegate == null) {
            throw new IllegalArgumentException("Unsupported script type: " + type);
        }
        return delegate;
    }
}
