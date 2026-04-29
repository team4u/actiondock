package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

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

    /**
     * 获取禁用状态的脚本互调服务实例。
     * <p>
     * 禁用状态下调用 {@link #invokePublished} 将抛出 {@link IllegalStateException}。
     *
     * @return 禁用状态的单例实例
     */
    public static ScriptInvocationService disabled() {
        return DISABLED;
    }

    /**
     * 同步调用已发布的目标脚本。
     * <p>
     * 根据脚本 ID 查找已发布的脚本定义，校验输入参数是否符合模式，
     * 构建嵌套执行上下文后同步执行目标脚本。
     * 支持脚本调用链路追踪和循环调用检测。
     *
     * @param scriptId          目标脚本 ID
     * @param callerDefinition  调用方脚本定义，用于构建调用栈
     * @param executionContext  当前执行上下文，包含执行 ID、配置等信息
     * @param input             传递给目标脚本的输入参数
     * @return 目标脚本的执行结果，已规范化为 Map 结构
     * @throws IllegalStateException    如果脚本互调未启用或检测到循环调用
     * @throws IllegalArgumentException 如果脚本不存在、未发布或输入参数校验失败
     */
    public Object invokePublished(String scriptId,
                                  ScriptDefinition callerDefinition,
                                  ScriptExecutionContext executionContext,
                                  Map<String, Object> input) {
        ensureEnabled();
        String normalizedScriptId = normalizeScriptId(scriptId);
        try {
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
        } catch (InvalidExecutionInputException exception) {
            throw new InvalidExecutionInputException(
                    exception.getScriptId(),
                    exception.getFieldErrors(),
                    prefixedInvocationMessage(normalizedScriptId, exception),
                    exception
            );
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(prefixedInvocationMessage(normalizedScriptId, exception), exception);
        } catch (IllegalStateException exception) {
            throw new IllegalStateException(prefixedInvocationMessage(normalizedScriptId, exception), exception);
        } catch (RuntimeException exception) {
            throw new IllegalStateException(prefixedInvocationMessage(normalizedScriptId, exception), exception);
        }
    }

    private ScriptEngine scriptEngine() {
        ScriptEngine scriptEngine = scriptEngineSupplier.get();
        if (scriptEngine == null) {
            throw new IllegalStateException("脚本执行引擎未就绪");
        }
        return scriptEngine;
    }

    private Map<String, Object> normalizeInput(Map<String, Object> input) {
        return ExecutionInputNormalizer.normalizeMap(input);
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

    private String prefixedInvocationMessage(String calleeScriptId, RuntimeException exception) {
        String prefix = "调用脚本 " + calleeScriptId + " 失败: ";
        String message = ErrorDetailSupport.summarize(exception);
        if (message.startsWith(prefix)) {
            return message;
        }
        return prefix + message;
    }
}
