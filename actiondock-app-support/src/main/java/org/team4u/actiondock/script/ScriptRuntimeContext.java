package org.team4u.actiondock.script;

import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Script-visible runtime metadata.
 */
public class ScriptRuntimeContext {
    private final ScriptExecutionContext executionContext;
    private final String artifactDir;

    ScriptRuntimeContext(ScriptExecutionContext executionContext, String artifactDir) {
        this.executionContext = executionContext;
        this.artifactDir = artifactDir;
    }

    public String getExecutionId() {
        return executionContext == null ? null : executionContext.getExecutionId();
    }

    public SubmitMode getSubmitMode() {
        return executionContext == null ? null : executionContext.getSubmitMode();
    }

    public String getArtifactDir() {
        return artifactDir;
    }

    Map<String, Object> asMap() {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("executionId", getExecutionId());
        values.put("submitMode", getSubmitMode() == null ? null : getSubmitMode().name());
        values.put("artifactDir", artifactDir);
        return values;
    }
}
