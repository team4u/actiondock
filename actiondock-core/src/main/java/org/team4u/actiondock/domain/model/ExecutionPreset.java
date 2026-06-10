package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 执行参数预设，保存脚本的常用参数组合以便快速加载。
 * <p>
 * 每个预设绑定一个脚本定义，存储一组命名的输入参数，
 * 支持团队成员复用常用的参数配置。
 *
 * @author jay.wu
 */
public class ExecutionPreset {

    private String id;
    private String scriptId;
    private String name;
    private Map<String, Object> input = new LinkedHashMap<>();
    private boolean managed;
    private boolean editable = true;
    private String repositoryId;
    private String repositoryPackageId;
    private String repositoryVersion;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public ExecutionPreset setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    public ExecutionPreset setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getName() {
        return name;
    }

    public ExecutionPreset setName(String name) {
        this.name = name;
        return this;
    }

    public Map<String, Object> getInput() {
        return input;
    }

    public ExecutionPreset setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
        return this;
    }

    public boolean isManaged() {
        return managed;
    }

    public ExecutionPreset setManaged(boolean managed) {
        this.managed = managed;
        return this;
    }

    public boolean isEditable() {
        return editable;
    }

    public ExecutionPreset setEditable(boolean editable) {
        this.editable = editable;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ExecutionPreset setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryPackageId() {
        return repositoryPackageId;
    }

    public ExecutionPreset setRepositoryPackageId(String repositoryPackageId) {
        this.repositoryPackageId = repositoryPackageId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public ExecutionPreset setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ExecutionPreset setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ExecutionPreset setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
