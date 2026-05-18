package org.team4u.actiondock.web.execution;

import org.team4u.actiondock.domain.model.SubmitMode;

import java.util.Map;

/**
 * 脚本执行请求参数。
 *
 * @author jay.wu
 */
public class ExecuteRequest {
    private String scriptId;
    private Map<String, Object> input;
    private SubmitMode mode = SubmitMode.SYNC;
    private ExecutionResponseView responseView = ExecutionResponseView.RESULT;
    private boolean draft;

    public String getScriptId() {
        return scriptId;
    }

    public void setScriptId(String scriptId) {
        this.scriptId = scriptId;
    }

    public Map<String, Object> getInput() {
        return input;
    }

    public void setInput(Map<String, Object> input) {
        this.input = input;
    }

    public SubmitMode getMode() {
        return mode;
    }

    public void setMode(SubmitMode mode) {
        this.mode = mode;
    }

    public ExecutionResponseView getResponseView() {
        return responseView;
    }

    public void setResponseView(ExecutionResponseView responseView) {
        this.responseView = responseView == null ? ExecutionResponseView.RESULT : responseView;
    }

    public boolean isDraft() {
        return draft;
    }

    public void setDraft(boolean draft) {
        this.draft = draft;
    }
}
