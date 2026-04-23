package org.team4u.scriptflow.script;

import org.team4u.scriptflow.application.ScriptInvocationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Groovy 脚本中的脚本互调桥接对象。
 */
public class GroovyScripts {
    private final ScriptInvocationService scriptInvocationService;
    private final ScriptDefinition definition;
    private final ScriptExecutionContext executionContext;

    public GroovyScripts(ScriptInvocationService scriptInvocationService,
                         ScriptDefinition definition,
                         ScriptExecutionContext executionContext) {
        this.scriptInvocationService = scriptInvocationService;
        this.definition = definition;
        this.executionContext = executionContext;
    }

    public Object invoke(String scriptId) {
        return invoke(scriptId, Map.of());
    }

    public Object invoke(String scriptId, Map<String, Object> args) {
        return scriptInvocationService.invokePublished(
                scriptId,
                definition,
                executionContext,
                args == null ? Map.of() : new LinkedHashMap<>(args)
        );
    }
}
