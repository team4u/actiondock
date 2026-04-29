package org.team4u.actiondock.domain.exception;

/**
 * 开发冲突异常，当远端工具已更新但本地也有未发布修改时抛出。
 *
 * @author jay.wu
 */
public class DevelopmentConflictException extends IllegalArgumentException {
    private final String scriptId;
    private final String repositoryId;
    private final String toolId;

    public DevelopmentConflictException(String scriptId, String repositoryId, String toolId) {
        super("远端工具已更新，但本地也有未发布修改");
        this.scriptId = scriptId;
        this.repositoryId = repositoryId;
        this.toolId = toolId;
    }

    public String getScriptId() {
        return scriptId;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public String getToolId() {
        return toolId;
    }
}
