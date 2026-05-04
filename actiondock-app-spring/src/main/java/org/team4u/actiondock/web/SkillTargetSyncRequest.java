package org.team4u.actiondock.web;

import java.util.List;

public class SkillTargetSyncRequest {
    private List<String> installationIds;

    public List<String> getInstallationIds() {
        return installationIds;
    }

    public void setInstallationIds(List<String> installationIds) {
        this.installationIds = installationIds;
    }
}
