package org.team4u.scriptflow.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 执行记录 JPA 实体，对应 execution_record 表。
 *
 * @author jay.wu
 */
@Entity
@Table(name = "execution_record")
public class ExecutionEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String scriptId;

    @Column(nullable = false)
    private String status;

    @Column(nullable = false)
    private String submitMode;

    @Column(nullable = false)
    private String triggerSource = "MANUAL";

    private String scheduleId;

    @Lob
    private String inputJson;

    @Lob
    private String outputJson;

    @Lob
    private String logsJson;

    @Lob
    private String errorMessage;

    private String errorType;

    @Lob
    private String errorStackTrace;

    private LocalDateTime createdAt;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getScriptId() { return scriptId; }
    public void setScriptId(String scriptId) { this.scriptId = scriptId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getSubmitMode() { return submitMode; }
    public void setSubmitMode(String submitMode) { this.submitMode = submitMode; }
    public String getTriggerSource() { return triggerSource; }
    public void setTriggerSource(String triggerSource) { this.triggerSource = triggerSource; }
    public String getScheduleId() { return scheduleId; }
    public void setScheduleId(String scheduleId) { this.scheduleId = scheduleId; }
    public String getInputJson() { return inputJson; }
    public void setInputJson(String inputJson) { this.inputJson = inputJson; }
    public String getOutputJson() { return outputJson; }
    public void setOutputJson(String outputJson) { this.outputJson = outputJson; }
    public String getLogsJson() { return logsJson; }
    public void setLogsJson(String logsJson) { this.logsJson = logsJson; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public String getErrorType() { return errorType; }
    public void setErrorType(String errorType) { this.errorType = errorType; }
    public String getErrorStackTrace() { return errorStackTrace; }
    public void setErrorStackTrace(String errorStackTrace) { this.errorStackTrace = errorStackTrace; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
}
