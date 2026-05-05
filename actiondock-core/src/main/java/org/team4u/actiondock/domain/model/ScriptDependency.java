package org.team4u.actiondock.domain.model;

import java.util.Objects;

/**
 * 脚本声明的仓库工具依赖。
 *
 * @author jay.wu
 */
public class ScriptDependency {
    private String scriptId;
    private String repositoryId;
    private String toolId;
    private String versionRange;

    public String getScriptId() {
        return scriptId;
    }

    public ScriptDependency setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ScriptDependency setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getToolId() {
        return toolId;
    }

    public ScriptDependency setToolId(String toolId) {
        this.toolId = toolId;
        return this;
    }

    public String getVersionRange() {
        return versionRange;
    }

    public ScriptDependency setVersionRange(String versionRange) {
        this.versionRange = versionRange;
        return this;
    }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof ScriptDependency other)) {
            return false;
        }
        return Objects.equals(scriptId, other.scriptId)
                && Objects.equals(repositoryId, other.repositoryId)
                && Objects.equals(toolId, other.toolId)
                && Objects.equals(versionRange, other.versionRange);
    }

    @Override
    public int hashCode() {
        return Objects.hash(scriptId, repositoryId, toolId, versionRange);
    }

    public ScriptDependency copy() {
        return new ScriptDependency()
                .setScriptId(scriptId)
                .setRepositoryId(repositoryId)
                .setToolId(toolId)
                .setVersionRange(versionRange);
    }
}
