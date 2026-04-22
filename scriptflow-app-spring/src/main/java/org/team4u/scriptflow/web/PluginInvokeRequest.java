package org.team4u.scriptflow.web;

import java.util.LinkedHashMap;
import java.util.Map;

public class PluginInvokeRequest {
    private Map<String, Object> args = new LinkedHashMap<>();
    private Map<String, Object> scriptInput = new LinkedHashMap<>();
    private ExecutionResponseView responseView = ExecutionResponseView.RESULT;

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
}
