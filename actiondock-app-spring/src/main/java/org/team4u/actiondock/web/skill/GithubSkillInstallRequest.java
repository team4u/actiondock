package org.team4u.actiondock.web.skill;

import java.util.List;

public class GithubSkillInstallRequest extends GithubSkillScanRequest {
    private List<String> targetIds;
    private List<String> skillPaths;

    public List<String> getTargetIds() {
        return targetIds;
    }

    public void setTargetIds(List<String> targetIds) {
        this.targetIds = targetIds;
    }

    public List<String> getSkillPaths() {
        return skillPaths;
    }

    public void setSkillPaths(List<String> skillPaths) {
        this.skillPaths = skillPaths;
    }
}
