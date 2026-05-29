package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 模型调用日志。
 * <p>
 * 记录一次 AI 模型调用的完整信息，包括调用来源、模型配置、令牌消耗、
 * 延迟及错误信息，用于审计追踪和用量分析。
 *
 * @author jay.wu
 */
public class AiCallLog {
    /** 日志唯一标识 */
    private String id;
    /** 关联的脚本执行记录标识 */
    private String executionId;
    /** 关联的脚本标识 */
    private String scriptId;
    /** 关联的插件标识 */
    private String pluginId;
    /** 关联的 Agent 运行标识 */
    private String agentRunId;
    /** 关联的 Agent 步骤标识 */
    private String agentStepId;
    /** 调用来源类型 */
    private AiCallerType callerType;
    /** 调用动作类型 */
    private AiCallAction action;
    /** 模型配置名称 */
    private String modelProfile;
    /** AI 模型提供商 */
    private AiProvider provider;
    /** 模型名称 */
    private String model;
    /** 调用状态 */
    private String status;
    /** 输入令牌数 */
    private Integer inputTokens;
    /** 输出令牌数 */
    private Integer outputTokens;
    /** 总令牌数 */
    private Integer totalTokens;
    /** 调用延迟（毫秒） */
    private Long latencyMs;
    /** 错误类型 */
    private String errorType;
    /** 错误消息 */
    private String errorMessage;
    /** 请求内容哈希值，用于缓存命中判断 */
    private String promptHash;
    /** 请求摘要信息 */
    private Map<String, Object> requestSummary = new LinkedHashMap<>();
    /** 响应摘要信息 */
    private Map<String, Object> responseSummary = new LinkedHashMap<>();
    /** 日志创建时间 */
    private LocalDateTime createdAt;

    public String getId() { return id; }
    public AiCallLog setId(String id) { this.id = id; return this; }
    public String getExecutionId() { return executionId; }
    public AiCallLog setExecutionId(String executionId) { this.executionId = executionId; return this; }
    public String getScriptId() { return scriptId; }
    public AiCallLog setScriptId(String scriptId) { this.scriptId = scriptId; return this; }
    public String getPluginId() { return pluginId; }
    public AiCallLog setPluginId(String pluginId) { this.pluginId = pluginId; return this; }
    public String getAgentRunId() { return agentRunId; }
    public AiCallLog setAgentRunId(String agentRunId) { this.agentRunId = agentRunId; return this; }
    public String getAgentStepId() { return agentStepId; }
    public AiCallLog setAgentStepId(String agentStepId) { this.agentStepId = agentStepId; return this; }
    public AiCallerType getCallerType() { return callerType; }
    public AiCallLog setCallerType(AiCallerType callerType) { this.callerType = callerType; return this; }
    public AiCallAction getAction() { return action; }
    public AiCallLog setAction(AiCallAction action) { this.action = action; return this; }
    public String getModelProfile() { return modelProfile; }
    public AiCallLog setModelProfile(String modelProfile) { this.modelProfile = modelProfile; return this; }
    public AiProvider getProvider() { return provider; }
    public AiCallLog setProvider(AiProvider provider) { this.provider = provider; return this; }
    public String getModel() { return model; }
    public AiCallLog setModel(String model) { this.model = model; return this; }
    public String getStatus() { return status; }
    public AiCallLog setStatus(String status) { this.status = status; return this; }
    public Integer getInputTokens() { return inputTokens; }
    public AiCallLog setInputTokens(Integer inputTokens) { this.inputTokens = inputTokens; return this; }
    public Integer getOutputTokens() { return outputTokens; }
    public AiCallLog setOutputTokens(Integer outputTokens) { this.outputTokens = outputTokens; return this; }
    public Integer getTotalTokens() { return totalTokens; }
    public AiCallLog setTotalTokens(Integer totalTokens) { this.totalTokens = totalTokens; return this; }
    public Long getLatencyMs() { return latencyMs; }
    public AiCallLog setLatencyMs(Long latencyMs) { this.latencyMs = latencyMs; return this; }
    public String getErrorType() { return errorType; }
    public AiCallLog setErrorType(String errorType) { this.errorType = errorType; return this; }
    public String getErrorMessage() { return errorMessage; }
    public AiCallLog setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; return this; }
    public String getPromptHash() { return promptHash; }
    public AiCallLog setPromptHash(String promptHash) { this.promptHash = promptHash; return this; }
    public Map<String, Object> getRequestSummary() { return Map.copyOf(requestSummary); }
    public AiCallLog setRequestSummary(Map<String, Object> requestSummary) { this.requestSummary = requestSummary == null ? new LinkedHashMap<>() : new LinkedHashMap<>(requestSummary); return this; }
    public Map<String, Object> getResponseSummary() { return Map.copyOf(responseSummary); }
    public AiCallLog setResponseSummary(Map<String, Object> responseSummary) { this.responseSummary = responseSummary == null ? new LinkedHashMap<>() : new LinkedHashMap<>(responseSummary); return this; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public AiCallLog setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; return this; }
}
