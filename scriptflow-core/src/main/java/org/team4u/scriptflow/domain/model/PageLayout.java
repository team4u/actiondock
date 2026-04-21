package org.team4u.scriptflow.domain.model;

public class PageLayout {
    private String formMode = "horizontal";
    private String submitText = "执行";
    private String resultTitle = "结果";

    public String getFormMode() {
        return formMode;
    }

    public PageLayout setFormMode(String formMode) {
        this.formMode = formMode;
        return this;
    }

    public String getSubmitText() {
        return submitText;
    }

    public PageLayout setSubmitText(String submitText) {
        this.submitText = submitText;
        return this;
    }

    public String getResultTitle() {
        return resultTitle;
    }

    public PageLayout setResultTitle(String resultTitle) {
        this.resultTitle = resultTitle;
        return this;
    }
}
