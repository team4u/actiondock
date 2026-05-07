package org.team4u.actiondock.web.capability;

import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.web.execution.ExecutionResponseView;

import java.util.Map;

/**
 * 统一能力执行请求，当前映射为脚本执行。
 */
public class CapabilityExecuteRequest {
    private Map<String, Object> input;
    private SubmitMode mode = SubmitMode.SYNC;
    private ExecutionResponseView responseView = ExecutionResponseView.RESULT;
    private boolean draft;

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
