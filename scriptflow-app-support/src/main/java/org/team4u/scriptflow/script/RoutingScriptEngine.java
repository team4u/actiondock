package org.team4u.scriptflow.script;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.domain.port.ScriptEngine;

import java.util.EnumMap;
import java.util.Map;

/**
 * 路由脚本引擎，根据脚本类型分发到对应的引擎实现。
 * <p>
 * 支持 Groovy 和 Python 两种脚本类型的路由。
 *
 * @author jay.wu
 */
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
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        return resolve(definition).execute(definition, input, executionContext);
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
