package org.team4u.scriptflow.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

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

    @Lob
    private String inputJson;

    @Lob
    private String rawOutputJson;

    @Lob
    private String structuredOutputJson;

    @Lob
    private String displayOutputJson;

    @Lob
    private String errorMessage;

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
    public String getInputJson() { return inputJson; }
    public void setInputJson(String inputJson) { this.inputJson = inputJson; }
    public String getRawOutputJson() { return rawOutputJson; }
    public void setRawOutputJson(String rawOutputJson) { this.rawOutputJson = rawOutputJson; }
    public String getStructuredOutputJson() { return structuredOutputJson; }
    public void setStructuredOutputJson(String structuredOutputJson) { this.structuredOutputJson = structuredOutputJson; }
    public String getDisplayOutputJson() { return displayOutputJson; }
    public void setDisplayOutputJson(String displayOutputJson) { this.displayOutputJson = displayOutputJson; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
}
