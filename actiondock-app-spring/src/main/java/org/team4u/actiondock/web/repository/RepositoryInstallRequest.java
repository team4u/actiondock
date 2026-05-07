package org.team4u.actiondock.web.repository;

/**
 * 仓库工具安装请求。
 *
 * @author jay.wu
 */
public class RepositoryInstallRequest {
    private boolean installSchedules;
    private boolean installScriptDependencies;
    private boolean installPluginDependencies;
    private boolean forcePluginUpgrade;

    public boolean isInstallSchedules() {
        return installSchedules;
    }

    public void setInstallSchedules(boolean installSchedules) {
        this.installSchedules = installSchedules;
    }

    public boolean isInstallScriptDependencies() {
        return installScriptDependencies;
    }

    public void setInstallScriptDependencies(boolean installScriptDependencies) {
        this.installScriptDependencies = installScriptDependencies;
    }

    public boolean isInstallPluginDependencies() {
        return installPluginDependencies;
    }

    public void setInstallPluginDependencies(boolean installPluginDependencies) {
        this.installPluginDependencies = installPluginDependencies;
    }

    public boolean isForcePluginUpgrade() {
        return forcePluginUpgrade;
    }

    public void setForcePluginUpgrade(boolean forcePluginUpgrade) {
        this.forcePluginUpgrade = forcePluginUpgrade;
    }
}
