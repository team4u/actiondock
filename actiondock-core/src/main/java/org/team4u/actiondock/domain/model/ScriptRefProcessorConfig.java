package org.team4u.actiondock.domain.model;

public class ScriptRefProcessorConfig {
    private String scriptId;
    private String versionMode = "PUBLISHED";

    public String getScriptId() {
        return scriptId;
    }

    public ScriptRefProcessorConfig setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getVersionMode() {
        return versionMode;
    }

    public ScriptRefProcessorConfig setVersionMode(String versionMode) {
        this.versionMode = versionMode == null || versionMode.isBlank() ? "PUBLISHED" : versionMode;
        return this;
    }
}
