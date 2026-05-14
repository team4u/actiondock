package org.team4u.actiondock.domain.model;

/**
 * 执行提交元数据，用于描述一次执行的触发来源及关联对象。
 */
public class ExecutionSubmissionMetadata {
    private ExecutionTriggerSource triggerSource = ExecutionTriggerSource.MANUAL;
    private String scheduleId;
    private String agentRunId;
    private String agentStepId;
    private String webhookId;

    public ExecutionTriggerSource getTriggerSource() {
        return triggerSource;
    }

    public ExecutionSubmissionMetadata setTriggerSource(ExecutionTriggerSource triggerSource) {
        this.triggerSource = triggerSource == null ? ExecutionTriggerSource.MANUAL : triggerSource;
        return this;
    }

    public String getScheduleId() {
        return scheduleId;
    }

    public ExecutionSubmissionMetadata setScheduleId(String scheduleId) {
        this.scheduleId = scheduleId;
        return this;
    }

    public String getAgentRunId() {
        return agentRunId;
    }

    public ExecutionSubmissionMetadata setAgentRunId(String agentRunId) {
        this.agentRunId = agentRunId;
        return this;
    }

    public String getAgentStepId() {
        return agentStepId;
    }

    public ExecutionSubmissionMetadata setAgentStepId(String agentStepId) {
        this.agentStepId = agentStepId;
        return this;
    }

    public String getWebhookId() {
        return webhookId;
    }

    public ExecutionSubmissionMetadata setWebhookId(String webhookId) {
        this.webhookId = webhookId;
        return this;
    }

    public static ExecutionSubmissionMetadata manual() {
        return new ExecutionSubmissionMetadata().setTriggerSource(ExecutionTriggerSource.MANUAL);
    }
}
