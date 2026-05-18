package org.team4u.actiondock.script;

import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Groovy 脚本中的脚本互调桥接对象。
 */
class GroovyScripts {
    private final ScriptInvocationService scriptInvocationService;
    private final ScriptDefinition definition;
    private final ScriptExecutionContext executionContext;

    /**
     * 创建脚本互调桥接对象。
     *
     * @param scriptInvocationService 脚本调用服务
     * @param definition              当前执行的脚本定义
     * @param executionContext        脚本执行上下文
     */
    GroovyScripts(ScriptInvocationService scriptInvocationService,
                         ScriptDefinition definition,
                         ScriptExecutionContext executionContext) {
        this.scriptInvocationService = scriptInvocationService;
        this.definition = definition;
        this.executionContext = executionContext;
    }

    /**
     * 调用指定已发布的脚本（无参数版本）。
     *
     * @param scriptId 目标脚本 ID
     * @return 被调用脚本的执行结果
     */
    public Object invoke(String scriptId) {
        return invoke(scriptId, Map.of());
    }

    /**
     * 调用指定已发布的脚本。
     * <p>
     * 在 Groovy 脚本中可通过 {@code scripts.invoke("target-script-id", [key: value])} 调用其他已发布脚本。
     *
     * @param scriptId 目标脚本 ID
     * @param args     传递给目标脚本的输入参数
     * @return 被调用脚本的执行结果
     */
    public Object invoke(String scriptId, Map<String, Object> args) {
        return scriptInvocationService.invokePublished(
                scriptId,
                definition,
                executionContext,
                args == null ? Map.of() : new LinkedHashMap<>(args)
        );
    }
}
