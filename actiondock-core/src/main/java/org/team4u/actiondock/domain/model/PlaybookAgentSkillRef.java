package org.team4u.actiondock.domain.model;

public class PlaybookAgentSkillRef {
    private String skillId;
    private String purpose;
    private boolean required;

    public String getSkillId() {
        return skillId;
    }

    public PlaybookAgentSkillRef setSkillId(String skillId) {
        this.skillId = skillId;
        return this;
    }

    public String getPurpose() {
        return purpose;
    }

    public PlaybookAgentSkillRef setPurpose(String purpose) {
        this.purpose = purpose;
        return this;
    }

    public boolean isRequired() {
        return required;
    }

    public PlaybookAgentSkillRef setRequired(boolean required) {
        this.required = required;
        return this;
    }
}
