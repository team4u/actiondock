package org.team4u.scriptflow.web;

/**
 * 仓库工具安装请求。
 *
 * @author jay.wu
 */
public class RepositoryInstallRequest {
    private boolean installSchedules;

    public boolean isInstallSchedules() {
        return installSchedules;
    }

    public void setInstallSchedules(boolean installSchedules) {
        this.installSchedules = installSchedules;
    }
}
