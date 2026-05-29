package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本执行记录，表示一次脚本执行的历史轨迹。
 * <p>
 * 记录包含执行的输入参数、输出结果、执行状态以及时间戳信息。
 * 支持同步和异步两种提交模式，可追踪执行的完整生命周期。
 *
 * @author jay.wu
 */
public class ExecutionRecord {
    private String id;
    private String scriptId;
    private ExecutionStatus status = ExecutionStatus.PENDING;
    private SubmitMode submitMode = SubmitMode.SYNC;
    private ExecutionTriggerSource triggerSource = ExecutionTriggerSource.MANUAL;
    private String scheduleId;
    private String agentRunId;
    private String agentStepId;
    private String webhookId;
    private Map<String, Object> input = new LinkedHashMap<>();
    private Map<String, Object> output = new LinkedHashMap<>();
    private List<ExecutionLogEntry> logs = new ArrayList<>();
    private String errorMessage;
    private ErrorDetail errorDetail;
    private LocalDateTime createdAt;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    public String getId() {
        return id;
    }

    /** 设置执行记录 ID。 */
    public ExecutionRecord setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    /** 设置关联的脚本 ID。 */
    public ExecutionRecord setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    /**
     * 获取执行状态。
     *
     * @return 当前执行状态
     */
    public ExecutionStatus getStatus() {
        return status;
    }

    /** 设置执行状态。 */
    public ExecutionRecord setStatus(ExecutionStatus status) {
        this.status = status;
        return this;
    }

    /**
     * 获取提交模式。
     *
     * @return 同步或异步提交模式
     */
    public SubmitMode getSubmitMode() {
        return submitMode;
    }

    /** 设置提交模式（同步/异步）。 */
    public ExecutionRecord setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode;
        return this;
    }

    public ExecutionTriggerSource getTriggerSource() {
        return triggerSource;
    }

    /** 设置触发来源。 */
    public ExecutionRecord setTriggerSource(ExecutionTriggerSource triggerSource) {
        this.triggerSource = triggerSource == null ? ExecutionTriggerSource.MANUAL : triggerSource;
        return this;
    }

    public String getScheduleId() {
        return scheduleId;
    }

    /** 设置关联的调度 ID（定时触发时使用）。 */
    public ExecutionRecord setScheduleId(String scheduleId) {
        this.scheduleId = scheduleId;
        return this;
    }

    public String getAgentRunId() {
        return agentRunId;
    }

    /** 设置关联的 Agent 运行 ID。 */
    public ExecutionRecord setAgentRunId(String agentRunId) {
        this.agentRunId = agentRunId;
        return this;
    }

    public String getAgentStepId() {
        return agentStepId;
    }

    /** 设置关联的 Agent 步骤 ID。 */
    public ExecutionRecord setAgentStepId(String agentStepId) {
        this.agentStepId = agentStepId;
        return this;
    }

    public String getWebhookId() {
        return webhookId;
    }

    /** 设置关联的 Webhook ID。 */
    public ExecutionRecord setWebhookId(String webhookId) {
        this.webhookId = webhookId;
        return this;
    }

    /**
     * 获取执行输入参数的不可变视图。
     *
     * @return 输入参数的不可变映射
     */
    public Map<String, Object> getInput() {
        return Collections.unmodifiableMap(input);
    }

    /** 设置执行输入参数（防御性复制）。 */
    public ExecutionRecord setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
        return this;
    }

    /**
     * 获取执行输出结果的不可变视图。
     *
     * @return 输出结果的不可变映射
     */
    public Map<String, Object> getOutput() {
        return Collections.unmodifiableMap(output);
    }

    /** 设置执行输出结果（防御性复制）。 */
    public ExecutionRecord setOutput(Map<String, Object> output) {
        this.output = output == null ? new LinkedHashMap<>() : new LinkedHashMap<>(output);
        return this;
    }

    /**
     * 获取执行日志的不可变视图。
     *
     * @return 执行日志列表的不可变视图
     */
    public List<ExecutionLogEntry> getLogs() {
        return Collections.unmodifiableList(logs);
    }

    /**
     * 添加一条执行日志。
     *
     * @param entry 日志条目
     */
    public void addLog(ExecutionLogEntry entry) {
        this.logs.add(entry);
    }

    /** 设置执行日志列表（防御性复制）。 */
    public ExecutionRecord setLogs(List<ExecutionLogEntry> logs) {
        this.logs = logs == null ? new ArrayList<>() : new ArrayList<>(logs);
        return this;
    }

    /**
     * 获取错误信息。
     * <p>
     * 仅在执行失败时包含错误描述，成功执行时为 null。
     *
     * @return 错误信息，如果无错误则返回 null
     */
    public String getErrorMessage() {
        return errorMessage;
    }

    /** 设置错误信息。 */
    public ExecutionRecord setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
        return this;
    }

    public ErrorDetail getErrorDetail() {
        return errorDetail;
    }

    /** 设置错误详情。 */
    public ExecutionRecord setErrorDetail(ErrorDetail errorDetail) {
        this.errorDetail = errorDetail;
        return this;
    }

    /**
     * 获取记录创建时间。
     *
     * @return 创建时间戳
     */
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    /** 设置记录创建时间。 */
    public ExecutionRecord setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    /**
     * 获取执行开始时间。
     *
     * @return 开始执行的时间戳，未开始则为 null
     */
    public LocalDateTime getStartedAt() {
        return startedAt;
    }

    /** 设置执行开始时间。 */
    public ExecutionRecord setStartedAt(LocalDateTime startedAt) {
        this.startedAt = startedAt;
        return this;
    }

    /**
     * 获取执行完成时间。
     *
     * @return 执行完成的时间戳，未完成则为 null
     */
    public LocalDateTime getFinishedAt() {
        return finishedAt;
    }

    /** 设置执行完成时间。 */
    public ExecutionRecord setFinishedAt(LocalDateTime finishedAt) {
        this.finishedAt = finishedAt;
        return this;
    }

    /**
     * 判断执行是否仍在活跃状态（PENDING 或 RUNNING）。
     *
     * @return 如果执行尚未结束则返回 true
     */
    public boolean isActive() {
        return status == ExecutionStatus.PENDING || status == ExecutionStatus.RUNNING;
    }
}
