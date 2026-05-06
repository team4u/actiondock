package org.team4u.actiondock.script;

import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.plugin.PluginRuntimeService;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Python 桥接响应器，负责处理 Python 子进程的脚本互调、插件调用和共享状态请求。
 *
 * @author jay.wu
 */
class PythonBridge {

    private final JsonCodec jsonCodec;
    private final ScriptInvocationService scriptInvocationService;
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptDefinition definition;
    private final Map<String, Object> input;
    private final ScriptExecutionContext executionContext;
    private final ScriptStateBridge stateBridge;

    PythonBridge(JsonCodec jsonCodec,
                 ScriptInvocationService scriptInvocationService,
                 PluginRuntimeService pluginRuntimeService,
                 SharedStateApplicationService sharedStateApplicationService,
                 ScriptDefinition definition,
                 Map<String, Object> input,
                 ScriptExecutionContext executionContext) {
        this.jsonCodec = jsonCodec;
        this.scriptInvocationService = scriptInvocationService;
        this.pluginRuntimeService = pluginRuntimeService;
        this.definition = definition;
        this.input = input == null ? Map.of() : new LinkedHashMap<>(input);
        this.executionContext = executionContext;
        this.stateBridge = new ScriptStateBridge(sharedStateApplicationService, definition, executionContext);
    }

    String respondInvocation(PythonScriptEngine.PythonInvocationRequest request) {
        return respond(() -> scriptInvocationService.invokePublished(
                request.scriptId(), definition, executionContext, request.args()));
    }

    String respondPlugin(PythonScriptEngine.PythonPluginRequest request) {
        return respond(() -> pluginRuntimeService.invoke(
                request.pluginId(), request.action(), definition, executionContext, input, request.args()));
    }

    String respondState(PythonScriptEngine.PythonStateRequest request) {
        return respond(() -> switch (request.operation()) {
            case "get" -> stateBridge.get(request.namespace(), request.key());
            case "put" -> stateBridge.put(request.namespace(), request.key(), request.value(), request.options());
            case "cas" -> stateBridge.cas(request.namespace(), request.key(), request.expectedVersion(), request.value(), request.options());
            case "delete" -> {
                stateBridge.delete(request.namespace(), request.key());
                yield null;
            }
            case "list" -> stateBridge.list(request.namespace());
            default -> throw new IllegalArgumentException("不支持的 state 操作: " + request.operation());
        });
    }

    private String writeResponse(boolean ok, Object data, String error) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("ok", ok);
        if (ok) {
            response.put("result", data);
        } else {
            response.put("error", error);
        }
        return jsonCodec.write(response);
    }

    private String respond(java.util.function.Supplier<Object> action) {
        try {
            return writeResponse(true, action.get(), null);
        } catch (Exception exception) {
            return writeResponse(false, null, ErrorDetailSupport.summarize(exception));
        }
    }
}
