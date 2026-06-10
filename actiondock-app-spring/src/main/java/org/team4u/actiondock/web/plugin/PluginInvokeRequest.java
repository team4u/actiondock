package org.team4u.actiondock.web.plugin;

import java.util.LinkedHashMap;
import java.util.Map;
import org.team4u.actiondock.web.execution.ExecutionResponseView;

/**
 * 插件调用请求，包含动作参数和模拟脚本输入。
 *
 * @author jay.wu
 */
public class PluginInvokeRequest {
    private Map<String, Object> args = new LinkedHashMap<>();
    private Map<String, Object> scriptInput = new LinkedHashMap<>();
    private ExecutionResponseView responseView = ExecutionResponseView.RESULT;
    private String configName;

    public Map<String, Object> getArgs() {
        return args;
    }

    public void setArgs(Map<String, Object> args) {
        this.args = args == null ? new LinkedHashMap<>() : new LinkedHashMap<>(args);
    }

    public Map<String, Object> getScriptInput() {
        return scriptInput;
    }

    public void setScriptInput(Map<String, Object> scriptInput) {
        this.scriptInput = scriptInput == null ? new LinkedHashMap<>() : new LinkedHashMap<>(scriptInput);
    }

    public ExecutionResponseView getResponseView() {
        return responseView;
    }

    public void setResponseView(ExecutionResponseView responseView) {
        this.responseView = responseView == null ? ExecutionResponseView.RESULT : responseView;
    }

    public String getConfigName() {
        return configName;
    }

    public void setConfigName(String configName) {
        this.configName = configName;
    }
}
