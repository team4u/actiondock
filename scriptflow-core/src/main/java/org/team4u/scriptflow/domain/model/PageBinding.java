package org.team4u.scriptflow.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class PageBinding {
    private String scriptId;
    private Map<String, String> inputMapping = new LinkedHashMap<>();
    private Map<String, String> outputMapping = new LinkedHashMap<>();
    private SubmitMode submitMode = SubmitMode.SYNC;

    public String getScriptId() {
        return scriptId;
    }

    public PageBinding setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public Map<String, String> getInputMapping() {
        return inputMapping;
    }

    public PageBinding setInputMapping(Map<String, String> inputMapping) {
        this.inputMapping = inputMapping == null ? new LinkedHashMap<>() : inputMapping;
        return this;
    }

    public Map<String, String> getOutputMapping() {
        return outputMapping;
    }

    public PageBinding setOutputMapping(Map<String, String> outputMapping) {
        this.outputMapping = outputMapping == null ? new LinkedHashMap<>() : outputMapping;
        return this;
    }

    public SubmitMode getSubmitMode() {
        return submitMode;
    }

    public PageBinding setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode;
        return this;
    }
}
