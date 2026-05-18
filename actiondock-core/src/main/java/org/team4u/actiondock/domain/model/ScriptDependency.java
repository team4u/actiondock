package org.team4u.actiondock.domain.model;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.util.Objects;

/**
 * 脚本声明的仓库脚本依赖。
 *
 * @author jay.wu
 */
public class ScriptDependency {
    private String scriptId;
    private String repositoryId;
    @JsonAlias("toolId")
    private String repositoryScriptId;
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

    public String getRepositoryScriptId() {
        return repositoryScriptId;
    }

    public ScriptDependency setRepositoryScriptId(String repositoryScriptId) {
        this.repositoryScriptId = repositoryScriptId;
        return this;
    }

    @Deprecated
    public ScriptDependency setToolId(String toolId) {
        return setRepositoryScriptId(toolId);
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
                && Objects.equals(repositoryScriptId, other.repositoryScriptId)
                && Objects.equals(versionRange, other.versionRange);
    }

    @Override
    public int hashCode() {
        return Objects.hash(scriptId, repositoryId, repositoryScriptId, versionRange);
    }

    public ScriptDependency copy() {
        return new ScriptDependency()
                .setScriptId(scriptId)
                .setRepositoryId(repositoryId)
                .setRepositoryScriptId(repositoryScriptId)
                .setVersionRange(versionRange);
    }
}
