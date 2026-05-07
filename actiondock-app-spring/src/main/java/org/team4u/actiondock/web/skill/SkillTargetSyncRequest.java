package org.team4u.actiondock.web.skill;

import java.util.List;

public class SkillTargetSyncRequest {
    private List<String> skillIds;

    public List<String> getSkillIds() {
        return skillIds;
    }

    public void setSkillIds(List<String> skillIds) {
        this.skillIds = skillIds;
    }
}
