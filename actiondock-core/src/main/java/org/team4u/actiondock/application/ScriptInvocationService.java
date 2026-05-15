package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * 脚本互调服务，提供已发布脚本之间的同步调用能力。
 */
public class ScriptInvocationService extends OptionalServiceSupport {
    private static final ScriptInvocationService DISABLED = new ScriptInvocationService();

    private final ScriptRepository scriptRepository;
    private final Supplier<ScriptEngine> scriptEngineSupplier;

    private ScriptInvocationService() {
        this.scriptRepository = null;
        this.scriptEngineSupplier = null;
    }

    public ScriptInvocationService(ScriptRepository scriptRepository, Supplier<ScriptEngine> scriptEngineSupplier) {
        super(true);
        this.scriptRepository = Objects.requireNonNull(scriptRepository);
        this.scriptEngineSupplier = Objects.requireNonNull(scriptEngineSupplier);
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
        String resolvedScriptId = resolveInvokedScriptId(normalizedScriptId, callerDefinition);
        try {
            ScriptDefinition definition = scriptRepository.findById(resolvedScriptId)
                    .orElseThrow(() -> new IllegalArgumentException(buildMissingScriptMessage(normalizedScriptId, callerDefinition)));
            if (!definition.hasPublishedRevision()) {
                throw new IllegalArgumentException("脚本未发布: " + resolvedScriptId);
            }

            ScriptDefinition publishedDefinition = definition.toPublishedDefinition();
            Map<String, Object> payload = normalizeInput(input);
            ScriptSchemaSupport.validateInput(publishedDefinition.getId(), payload, publishedDefinition.getInputSchema());

            ScriptExecutionContext nestedContext = childContext(
                    callerDefinition,
                    executionContext,
                    publishedDefinition.getId()
            );
            Object result = scriptEngine().execute(publishedDefinition, payload, nestedContext);
            return MapValueConverter.toResultMap(result);
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

    private static Map<String, Object> normalizeInput(Map<String, Object> input) {
        return ExecutionInputNormalizer.normalizeMap(input);
    }

    private static String normalizeScriptId(String scriptId) {
        return ApplicationServiceSupport.normalize(scriptId, "scriptId 不能为空");
    }

    private String resolveInvokedScriptId(String scriptId, ScriptDefinition callerDefinition) {
        if (callerDefinition == null) {
            return scriptId;
        }
        return callerDefinition.getScriptDependencies().stream()
                .filter(dependency -> scriptId.equals(dependency.getScriptId()))
                .findFirst()
                .map(dependency -> scriptRepository.findInstalledByRepositorySource(
                        dependency.getRepositoryId(),
                        dependency.getRepositoryScriptId()
                ).map(ScriptDefinition::getId).orElseGet(() -> defaultInstalledScriptId(
                        dependency.getRepositoryId(),
                        dependency.getRepositoryScriptId()
                )))
                .orElse(scriptId);
    }

    private static String buildMissingScriptMessage(String requestedScriptId, ScriptDefinition callerDefinition) {
        if (callerDefinition == null) {
            return "脚本不存在: " + requestedScriptId;
        }
        return callerDefinition.getScriptDependencies().stream()
                .filter(dependency -> requestedScriptId.equals(dependency.getScriptId()))
                .findFirst()
                .map(dependency -> "缺少脚本依赖: " + requestedScriptId
                        + " -> " + defaultInstalledScriptId(dependency.getRepositoryId(), dependency.getRepositoryScriptId())
                        + " " + dependency.getVersionRange())
                .orElse("脚本不存在: " + requestedScriptId);
    }

    private static String defaultInstalledScriptId(String repositoryId, String repositoryScriptId) {
        return repositoryId + "." + repositoryScriptId;
    }

    private static ScriptExecutionContext childContext(ScriptDefinition callerDefinition,
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

    private static List<String> nextStack(ScriptDefinition callerDefinition,
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

    @Override
    protected String serviceName() {
        return "脚本互调";
    }

    private static String prefixedInvocationMessage(String calleeScriptId, RuntimeException exception) {
        String prefix = "调用脚本 " + calleeScriptId + " 失败: ";
        String message = ErrorDetailSupport.summarize(exception);
        if (message.startsWith(prefix)) {
            return message;
        }
        return prefix + message;
    }
}
