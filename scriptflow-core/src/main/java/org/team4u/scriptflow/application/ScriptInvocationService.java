package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * 脚本互调服务，提供已发布脚本之间的同步调用能力。
 */
public class ScriptInvocationService {
    private static final ScriptInvocationService DISABLED = new ScriptInvocationService();

    private final ScriptRepository scriptRepository;
    private final Supplier<ScriptEngine> scriptEngineSupplier;
    private final ScriptSchemaSupport scriptSchemaSupport;
    private final boolean enabled;

    private ScriptInvocationService() {
        this.scriptRepository = null;
        this.scriptEngineSupplier = null;
        this.scriptSchemaSupport = new ScriptSchemaSupport();
        this.enabled = false;
    }

    public ScriptInvocationService(ScriptRepository scriptRepository, Supplier<ScriptEngine> scriptEngineSupplier) {
        this.scriptRepository = Objects.requireNonNull(scriptRepository);
        this.scriptEngineSupplier = Objects.requireNonNull(scriptEngineSupplier);
        this.scriptSchemaSupport = new ScriptSchemaSupport();
        this.enabled = true;
    }

    public static ScriptInvocationService disabled() {
        return DISABLED;
    }

    public Object invokePublished(String scriptId,
                                  ScriptDefinition callerDefinition,
                                  ScriptExecutionContext executionContext,
                                  Map<String, Object> input) {
        ensureEnabled();
        String normalizedScriptId = normalizeScriptId(scriptId);
        ScriptDefinition definition = scriptRepository.findById(normalizedScriptId)
                .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + normalizedScriptId));
        if (definition.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("脚本未发布: " + normalizedScriptId);
        }

        ScriptDefinition publishedDefinition = definition.toPublishedDefinition();
        Map<String, Object> payload = normalizeInput(input);
        scriptSchemaSupport.validateInput(publishedDefinition.getId(), payload, publishedDefinition.getInputSchema());

        ScriptExecutionContext nestedContext = childContext(
                callerDefinition,
                executionContext,
                publishedDefinition.getId()
        );
        Object result = scriptEngine().execute(publishedDefinition, payload, nestedContext);
        return normalizeResult(result);
    }

    private ScriptEngine scriptEngine() {
        ScriptEngine scriptEngine = scriptEngineSupplier.get();
        if (scriptEngine == null) {
            throw new IllegalStateException("脚本执行引擎未就绪");
        }
        return scriptEngine;
    }

    private Map<String, Object> normalizeInput(Map<String, Object> input) {
        return input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
    }

    private String normalizeScriptId(String scriptId) {
        if (scriptId == null || scriptId.isBlank()) {
            throw new IllegalArgumentException("scriptId 不能为空");
        }
        return scriptId.trim();
    }

    private ScriptExecutionContext childContext(ScriptDefinition callerDefinition,
                                                ScriptExecutionContext parentContext,
                                                String calleeScriptId) {
        List<String> nextStack = nextStack(callerDefinition, parentContext, calleeScriptId);
        return new ScriptExecutionContext()
                .setExecutionId(parentContext == null ? null : parentContext.getExecutionId())
                .setSubmitMode(parentContext == null ? null : parentContext.getSubmitMode())
                .setConfig(parentContext == null ? null : parentContext.getConfig())
                .setLogger(parentContext == null ? null : parentContext.getLogger())
                .setScriptStack(nextStack)
                .setLogPrefix("[script:" + calleeScriptId + "] ");
    }

    private List<String> nextStack(ScriptDefinition callerDefinition,
                                   ScriptExecutionContext parentContext,
                                   String calleeScriptId) {
        List<String> stack = new ArrayList<>(parentContext == null ? List.of() : parentContext.getScriptStack());
        String callerScriptId = callerDefinition == null ? null : callerDefinition.getId();
        if (stack.isEmpty() && callerScriptId != null && !callerScriptId.isBlank()) {
            stack.add(callerScriptId);
        }
        if (stack.contains(calleeScriptId)) {
            List<String> cycle = new ArrayList<>(stack);
            cycle.add(calleeScriptId);
            throw new IllegalStateException("检测到脚本循环调用: " + String.join(" -> ", cycle));
        }
        stack.add(calleeScriptId);
        return List.copyOf(stack);
    }

    private Map<String, Object> normalizeResult(Object result) {
        if (result == null) {
            return new LinkedHashMap<>();
        }
        if (result instanceof Map<?, ?> map) {
            Map<String, Object> normalized = new LinkedHashMap<>();
            map.forEach((key, value) -> normalized.put(String.valueOf(key), value));
            return normalized;
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("result", result);
        return normalized;
    }

    private void ensureEnabled() {
        if (!enabled) {
            throw new IllegalStateException("脚本互调未启用");
        }
    }
}
