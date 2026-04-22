package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
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

    public ExecutionRecord setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

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

    public ExecutionRecord setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode;
        return this;
    }

    public ExecutionTriggerSource getTriggerSource() {
        return triggerSource;
    }

    public ExecutionRecord setTriggerSource(ExecutionTriggerSource triggerSource) {
        this.triggerSource = triggerSource == null ? ExecutionTriggerSource.MANUAL : triggerSource;
        return this;
    }

    public String getScheduleId() {
        return scheduleId;
    }

    public ExecutionRecord setScheduleId(String scheduleId) {
        this.scheduleId = scheduleId;
        return this;
    }

    /**
     * 获取执行输入参数。
     * <p>
     * 返回参数映射表的引用，键为参数名，值为参数值。
     *
     * @return 输入参数映射，如果为空则返回空 Map
     */
    public Map<String, Object> getInput() {
        return input;
    }

    public ExecutionRecord setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : input;
        return this;
    }

    /**
     * 获取执行输出结果。
     * <p>
     * 返回结果映射表的引用，键为输出名，值为输出值。
     *
     * @return 输出结果映射，如果为空则返回空 Map
     */
    public Map<String, Object> getOutput() {
        return output;
    }

    public ExecutionRecord setOutput(Map<String, Object> output) {
        this.output = output == null ? new LinkedHashMap<>() : output;
        return this;
    }

    public List<ExecutionLogEntry> getLogs() {
        return logs;
    }

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

    public ExecutionRecord setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
        return this;
    }

    public ErrorDetail getErrorDetail() {
        return errorDetail;
    }

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

    public ExecutionRecord setFinishedAt(LocalDateTime finishedAt) {
        this.finishedAt = finishedAt;
        return this;
    }
}
