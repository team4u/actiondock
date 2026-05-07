package org.team4u.actiondock.domain.model;

public class RepositoryEventTriggerBinding {
    private String templateId;
    private String repositoryId;
    private String toolId;
    private String versionRange;
    private String scriptId;

    public String getTemplateId() {
        return templateId;
    }

    public RepositoryEventTriggerBinding setTemplateId(String templateId) {
        this.templateId = templateId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public RepositoryEventTriggerBinding setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getToolId() {
        return toolId;
    }

    public RepositoryEventTriggerBinding setToolId(String toolId) {
        this.toolId = toolId;
        return this;
    }

    public String getVersionRange() {
        return versionRange;
    }

    public RepositoryEventTriggerBinding setVersionRange(String versionRange) {
        this.versionRange = versionRange;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    public RepositoryEventTriggerBinding setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }
}
