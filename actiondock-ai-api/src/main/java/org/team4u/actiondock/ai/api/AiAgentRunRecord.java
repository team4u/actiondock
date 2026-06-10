package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI Agent 运行记录。
 * <p>
 * 持久化的 Agent 运行实体，记录每次运行的完整生命周期信息，包括调用来源、
 * 关联脚本与执行记录、输入输出摘要、模型与工具调用统计以及时间戳。
 * 使用流式 setter 支持链式调用，集合字段提供防御性拷贝。
 *
 * @author jay.wu
 */
public class AiAgentRunRecord {
    private String id;
    private String agentProfile;
    private AiRunStatus status;
    private AiCallerType callerType;
    private String scriptId;
    private String executionId;
    private String userId;
    private Map<String, Object> inputSummary = new LinkedHashMap<>();
    private Map<String, Object> outputSummary = new LinkedHashMap<>();
    private Integer totalModelCalls;
    private Integer totalToolCalls;
    private Integer totalTokens;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
    private String errorMessage;

    public String getId() { return id; }
    public AiAgentRunRecord setId(String id) { this.id = id; return this; }
    public String getAgentProfile() { return agentProfile; }
    public AiAgentRunRecord setAgentProfile(String agentProfile) { this.agentProfile = agentProfile; return this; }
    public AiRunStatus getStatus() { return status; }
    public AiAgentRunRecord setStatus(AiRunStatus status) { this.status = status; return this; }
    public AiCallerType getCallerType() { return callerType; }
    public AiAgentRunRecord setCallerType(AiCallerType callerType) { this.callerType = callerType; return this; }
    public String getScriptId() { return scriptId; }
    public AiAgentRunRecord setScriptId(String scriptId) { this.scriptId = scriptId; return this; }
    public String getExecutionId() { return executionId; }
    public AiAgentRunRecord setExecutionId(String executionId) { this.executionId = executionId; return this; }
    public String getUserId() { return userId; }
    public AiAgentRunRecord setUserId(String userId) { this.userId = userId; return this; }
    public Map<String, Object> getInputSummary() { return Map.copyOf(inputSummary); }
    public AiAgentRunRecord setInputSummary(Map<String, Object> inputSummary) { this.inputSummary = inputSummary == null ? new LinkedHashMap<>() : new LinkedHashMap<>(inputSummary); return this; }
    public Map<String, Object> getOutputSummary() { return Map.copyOf(outputSummary); }
    public AiAgentRunRecord setOutputSummary(Map<String, Object> outputSummary) { this.outputSummary = outputSummary == null ? new LinkedHashMap<>() : new LinkedHashMap<>(outputSummary); return this; }
    public Integer getTotalModelCalls() { return totalModelCalls; }
    public AiAgentRunRecord setTotalModelCalls(Integer totalModelCalls) { this.totalModelCalls = totalModelCalls; return this; }
    public Integer getTotalToolCalls() { return totalToolCalls; }
    public AiAgentRunRecord setTotalToolCalls(Integer totalToolCalls) { this.totalToolCalls = totalToolCalls; return this; }
    public Integer getTotalTokens() { return totalTokens; }
    public AiAgentRunRecord setTotalTokens(Integer totalTokens) { this.totalTokens = totalTokens; return this; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public AiAgentRunRecord setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; return this; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public AiAgentRunRecord setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; return this; }
    public String getErrorMessage() { return errorMessage; }
    public AiAgentRunRecord setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; return this; }
}
