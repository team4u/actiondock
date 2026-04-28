package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AiAgentProfile {
    private String id;
    private String name;
    private String description;
    private AiProvider provider = AiProvider.AGENTSCOPE;
    private String modelProfileId;
    private String systemPrompt;
    private List<String> toolsetIds = new ArrayList<>();
    private Map<String, Object> options = new LinkedHashMap<>();
    private Map<String, Object> policy = new LinkedHashMap<>();
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public AiAgentProfile setId(String id) { this.id = id; return this; }
    public String getName() { return name; }
    public AiAgentProfile setName(String name) { this.name = name; return this; }
    public String getDescription() { return description; }
    public AiAgentProfile setDescription(String description) { this.description = description; return this; }
    public AiProvider getProvider() { return provider; }
    public AiAgentProfile setProvider(AiProvider provider) { this.provider = provider == null ? AiProvider.AGENTSCOPE : provider; return this; }
    public String getModelProfileId() { return modelProfileId; }
    public AiAgentProfile setModelProfileId(String modelProfileId) { this.modelProfileId = modelProfileId; return this; }
    public String getSystemPrompt() { return systemPrompt; }
    public AiAgentProfile setSystemPrompt(String systemPrompt) { this.systemPrompt = systemPrompt; return this; }
    public List<String> getToolsetIds() { return List.copyOf(toolsetIds); }
    public AiAgentProfile setToolsetIds(List<String> toolsetIds) { this.toolsetIds = toolsetIds == null ? new ArrayList<>() : new ArrayList<>(toolsetIds); return this; }
    public Map<String, Object> getOptions() { return Map.copyOf(options); }
    public AiAgentProfile setOptions(Map<String, Object> options) { this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options); return this; }
    public Map<String, Object> getPolicy() { return Map.copyOf(policy); }
    public AiAgentProfile setPolicy(Map<String, Object> policy) { this.policy = policy == null ? new LinkedHashMap<>() : new LinkedHashMap<>(policy); return this; }
    public boolean isEnabled() { return enabled; }
    public AiAgentProfile setEnabled(boolean enabled) { this.enabled = enabled; return this; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public AiAgentProfile setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; return this; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public AiAgentProfile setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; return this; }
}
