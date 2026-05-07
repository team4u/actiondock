package org.team4u.actiondock.web.skill;

import java.util.List;

public class SkillBatchInstallRequest extends SkillDirectoryRequest {
    private List<String> targetIds;

    public List<String> getTargetIds() {
        return targetIds;
    }

    public void setTargetIds(List<String> targetIds) {
        this.targetIds = targetIds;
    }
}
