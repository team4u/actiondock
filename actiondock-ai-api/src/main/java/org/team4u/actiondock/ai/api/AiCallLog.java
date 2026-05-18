package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class AiCallLog {
    private String id;
    private String executionId;
    private String scriptId;
    private String pluginId;
    private String agentRunId;
    private String agentStepId;
    private AiCallerType callerType;
    private AiCallAction action;
    private String modelProfile;
    private AiProvider provider;
    private String model;
    private String status;
    private Integer inputTokens;
    private Integer outputTokens;
    private Integer totalTokens;
    private Long latencyMs;
    private String errorType;
    private String errorMessage;
    private String promptHash;
    private Map<String, Object> requestSummary = new LinkedHashMap<>();
    private Map<String, Object> responseSummary = new LinkedHashMap<>();
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
