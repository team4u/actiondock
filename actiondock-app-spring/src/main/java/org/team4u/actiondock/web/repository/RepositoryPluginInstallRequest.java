package org.team4u.actiondock.web.repository;

/**
 * 仓库插件安装/更新请求。
 *
 * @author jay.wu
 */
public class RepositoryPluginInstallRequest {
    private boolean force;

    public boolean isForce() {
        return force;
    }

    public void setForce(boolean force) {
        this.force = force;
    }
}
