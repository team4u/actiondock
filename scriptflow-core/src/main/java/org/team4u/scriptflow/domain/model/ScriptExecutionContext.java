package org.team4u.scriptflow.domain.model;

public class ScriptExecutionContext {
    private String executionId;
    private SubmitMode submitMode;

    public String getExecutionId() {
        return executionId;
    }

    public ScriptExecutionContext setExecutionId(String executionId) {
        this.executionId = executionId;
        return this;
    }

    public SubmitMode getSubmitMode() {
        return submitMode;
    }

    public ScriptExecutionContext setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode;
        return this;
    }
}
