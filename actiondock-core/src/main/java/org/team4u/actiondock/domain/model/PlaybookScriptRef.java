package org.team4u.actiondock.domain.model;

public class PlaybookScriptRef {
    private String scriptId;
    private String purpose;

    public String getScriptId() {
        return scriptId;
    }

    public PlaybookScriptRef setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getPurpose() {
        return purpose;
    }

    public PlaybookScriptRef setPurpose(String purpose) {
        this.purpose = purpose;
        return this;
    }
}
