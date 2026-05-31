package org.team4u.actiondock.domain.model;

public class PlaybookRelatedRef {
    private String playbookId;
    private PlaybookRelatedRefRelation relation = PlaybookRelatedRefRelation.RELATED;
    private String purpose;

    public String getPlaybookId() {
        return playbookId;
    }

    public PlaybookRelatedRef setPlaybookId(String playbookId) {
        this.playbookId = playbookId;
        return this;
    }

    public PlaybookRelatedRefRelation getRelation() {
        return relation;
    }

    public PlaybookRelatedRef setRelation(PlaybookRelatedRefRelation relation) {
        this.relation = relation == null ? PlaybookRelatedRefRelation.RELATED : relation;
        return this;
    }

    public String getPurpose() {
        return purpose;
    }

    public PlaybookRelatedRef setPurpose(String purpose) {
        this.purpose = purpose;
        return this;
    }
}
