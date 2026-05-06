package org.team4u.actiondock.domain.model;

public class ScriptRefProcessorConfig {

    private static final String DEFAULT_VERSION_MODE = "PUBLISHED";

    private String scriptId;
    private String versionMode = DEFAULT_VERSION_MODE;

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
        this.versionMode = versionMode == null || versionMode.isBlank() ? DEFAULT_VERSION_MODE : versionMode;
        return this;
    }
}
