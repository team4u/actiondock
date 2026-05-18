package org.team4u.actiondock.domain.model;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 脚本定时调度配置，定义脚本的 Cron 定时执行规则。
 * <p>
 * 每个调度绑定一个脚本定义，通过 Cron 表达式控制执行周期，
 * 支持启用/禁用和记录最近一次触发信息。
 *
 * @author jay.wu
 */
public class ScriptSchedule {
    private String id;
    private String scriptId;
    private String name;
    private String cronExpression;
    private Map<String, Object> input = new LinkedHashMap<>();
    private boolean enabled = true;
    private boolean editable = true;
    private String repositoryId;
    @JsonAlias("repositoryToolId")
    private String repositoryScriptId;
    private String repositoryPackageId;
    private String repositoryVersion;
    private LocalDateTime lastTriggeredAt;
    private String lastExecutionId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public ScriptSchedule setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    public ScriptSchedule setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getName() {
        return name;
    }

    public ScriptSchedule setName(String name) {
        this.name = name;
        return this;
    }

    public String getCronExpression() {
        return cronExpression;
    }

    public ScriptSchedule setCronExpression(String cronExpression) {
        this.cronExpression = cronExpression;
        return this;
    }

    public Map<String, Object> getInput() {
        return Collections.unmodifiableMap(input);
    }

    public ScriptSchedule setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public ScriptSchedule setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public boolean isEditable() {
        return editable;
    }

    public ScriptSchedule setEditable(boolean editable) {
        this.editable = editable;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ScriptSchedule setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryScriptId() {
        return repositoryScriptId;
    }

    public ScriptSchedule setRepositoryScriptId(String repositoryScriptId) {
        this.repositoryScriptId = repositoryScriptId;
        return this;
    }

    @Deprecated
    public ScriptSchedule setRepositoryToolId(String repositoryToolId) {
        return setRepositoryScriptId(repositoryToolId);
    }

    public String getRepositoryPackageId() {
        return repositoryPackageId;
    }

    public ScriptSchedule setRepositoryPackageId(String repositoryPackageId) {
        this.repositoryPackageId = repositoryPackageId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public ScriptSchedule setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public LocalDateTime getLastTriggeredAt() {
        return lastTriggeredAt;
    }

    public ScriptSchedule setLastTriggeredAt(LocalDateTime lastTriggeredAt) {
        this.lastTriggeredAt = lastTriggeredAt;
        return this;
    }

    public String getLastExecutionId() {
        return lastExecutionId;
    }

    public ScriptSchedule setLastExecutionId(String lastExecutionId) {
        this.lastExecutionId = lastExecutionId;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ScriptSchedule setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ScriptSchedule setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public ScriptSchedule copy() {
        return new ScriptSchedule()
                .setId(id)
                .setScriptId(scriptId)
                .setName(name)
                .setCronExpression(cronExpression)
                .setInput(input)
                .setEnabled(enabled)
                .setEditable(editable)
                .setRepositoryId(repositoryId)
                .setRepositoryScriptId(repositoryScriptId)
                .setRepositoryPackageId(repositoryPackageId)
                .setRepositoryVersion(repositoryVersion)
                .setLastTriggeredAt(lastTriggeredAt)
                .setLastExecutionId(lastExecutionId)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt);
    }
}
