package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 执行参数预设 JPA 实体，对应 execution_preset 表。
 *
 * @author jay.wu
 */
@Entity
@Table(name = "execution_preset", indexes = {
        @Index(name = "idx_execution_preset_script_id", columnList = "scriptId")
})
public class ExecutionPresetEntity {

    @Id
    private String id;

    @Column(nullable = false)
    private String scriptId;

    @Column(nullable = false)
    private String name;

    @Lob
    private String inputJson;

    @Column(nullable = false)
    private boolean managed;

    @Column(nullable = false)
    private boolean editable = true;

    private String repositoryId;

    private String repositoryPackageId;

    private String repositoryVersion;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getScriptId() {
        return scriptId;
    }

    public void setScriptId(String scriptId) {
        this.scriptId = scriptId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getInputJson() {
        return inputJson;
    }

    public void setInputJson(String inputJson) {
        this.inputJson = inputJson;
    }

    public boolean isManaged() {
        return managed;
    }

    public void setManaged(boolean managed) {
        this.managed = managed;
    }

    public boolean isEditable() {
        return editable;
    }

    public void setEditable(boolean editable) {
        this.editable = editable;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public void setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
    }

    public String getRepositoryPackageId() {
        return repositoryPackageId;
    }

    public void setRepositoryPackageId(String repositoryPackageId) {
        this.repositoryPackageId = repositoryPackageId;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public void setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
