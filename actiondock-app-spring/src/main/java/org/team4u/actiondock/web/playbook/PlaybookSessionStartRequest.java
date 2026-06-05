package org.team4u.actiondock.web.playbook;

import java.util.List;
import java.util.Map;

public class PlaybookSessionStartRequest {
    private String userPrompt;
    private String intent;
    private String agentName;
    private String agentRunId;
    private String parentSessionId;
    private String handoffFromSessionId;
    private String handoffRelation;
    private Map<String, Object> selectedFrom;
    private List<String> candidatePlaybookIds;

    public String getUserPrompt() { return userPrompt; }
    public void setUserPrompt(String userPrompt) { this.userPrompt = userPrompt; }
    public String getIntent() { return intent; }
    public void setIntent(String intent) { this.intent = intent; }
    public String getAgentName() { return agentName; }
    public void setAgentName(String agentName) { this.agentName = agentName; }
    public String getAgentRunId() { return agentRunId; }
    public void setAgentRunId(String agentRunId) { this.agentRunId = agentRunId; }
    public String getParentSessionId() { return parentSessionId; }
    public void setParentSessionId(String parentSessionId) { this.parentSessionId = parentSessionId; }
    public String getHandoffFromSessionId() { return handoffFromSessionId; }
    public void setHandoffFromSessionId(String handoffFromSessionId) { this.handoffFromSessionId = handoffFromSessionId; }
    public String getHandoffRelation() { return handoffRelation; }
    public void setHandoffRelation(String handoffRelation) { this.handoffRelation = handoffRelation; }
    public Map<String, Object> getSelectedFrom() { return selectedFrom; }
    public void setSelectedFrom(Map<String, Object> selectedFrom) { this.selectedFrom = selectedFrom; }
    public List<String> getCandidatePlaybookIds() { return candidatePlaybookIds; }
    public void setCandidatePlaybookIds(List<String> candidatePlaybookIds) { this.candidatePlaybookIds = candidatePlaybookIds; }
}
