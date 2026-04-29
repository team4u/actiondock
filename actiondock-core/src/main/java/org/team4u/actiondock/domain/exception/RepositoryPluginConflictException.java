package org.team4u.actiondock.domain.exception;

import java.util.List;

/**
 * 插件版本冲突异常，当安装的插件版本会影响已安装工具时抛出。
 *
 * @author jay.wu
 */
public class RepositoryPluginConflictException extends IllegalArgumentException {
    private final String pluginId;
    private final List<RepositoryPluginConflict> conflicts;

    public RepositoryPluginConflictException(String pluginId, List<RepositoryPluginConflict> conflicts) {
        super("插件版本会影响已安装工具: " + pluginId);
        this.pluginId = pluginId;
        this.conflicts = conflicts == null ? List.of() : List.copyOf(conflicts);
    }

    public String getPluginId() {
        return pluginId;
    }

    public List<RepositoryPluginConflict> getConflicts() {
        return conflicts;
    }
}
