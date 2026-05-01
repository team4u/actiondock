package org.team4u.actiondock.domain.model;

/**
 * 执行提交元数据，用于描述一次执行的触发来源及关联对象。
 */
public class ExecutionSubmissionMetadata {
    private ExecutionTriggerSource triggerSource = ExecutionTriggerSource.MANUAL;
    private String scheduleId;
    private String agentRunId;
    private String agentStepId;
    private String eventSourceId;
    private String eventTriggerId;
    private String eventRecordId;
    private String eventDispatchId;

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

    public String getEventSourceId() {
        return eventSourceId;
    }

    public ExecutionSubmissionMetadata setEventSourceId(String eventSourceId) {
        this.eventSourceId = eventSourceId;
        return this;
    }

    public String getEventTriggerId() {
        return eventTriggerId;
    }

    public ExecutionSubmissionMetadata setEventTriggerId(String eventTriggerId) {
        this.eventTriggerId = eventTriggerId;
        return this;
    }

    public String getEventRecordId() {
        return eventRecordId;
    }

    public ExecutionSubmissionMetadata setEventRecordId(String eventRecordId) {
        this.eventRecordId = eventRecordId;
        return this;
    }

    public String getEventDispatchId() {
        return eventDispatchId;
    }

    public ExecutionSubmissionMetadata setEventDispatchId(String eventDispatchId) {
        this.eventDispatchId = eventDispatchId;
        return this;
    }

    public static ExecutionSubmissionMetadata manual() {
        return new ExecutionSubmissionMetadata().setTriggerSource(ExecutionTriggerSource.MANUAL);
    }
}
