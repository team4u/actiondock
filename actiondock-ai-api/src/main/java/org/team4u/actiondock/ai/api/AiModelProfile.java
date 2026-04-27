package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public class AiModelProfile {
    private String id;
    private String name;
    private AiProvider provider = AiProvider.AGENTSCOPE;
    private AiModelProvider modelProvider;
    private String modelName;
    private String baseUrl;
    private String apiKeyConfigKey;
    private Map<String, Object> defaultOptions = new LinkedHashMap<>();
    private Map<String, Object> limits = new LinkedHashMap<>();
    private Set<AiCapability> capabilities = new LinkedHashSet<>();
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public AiModelProfile setId(String id) { this.id = id; return this; }
    public String getName() { return name; }
    public AiModelProfile setName(String name) { this.name = name; return this; }
    public AiProvider getProvider() { return provider; }
    public AiModelProfile setProvider(AiProvider provider) { this.provider = provider == null ? AiProvider.AGENTSCOPE : provider; return this; }
    public AiModelProvider getModelProvider() { return modelProvider; }
    public AiModelProfile setModelProvider(AiModelProvider modelProvider) { this.modelProvider = modelProvider; return this; }
    public String getModelName() { return modelName; }
    public AiModelProfile setModelName(String modelName) { this.modelName = modelName; return this; }
    public String getBaseUrl() { return baseUrl; }
    public AiModelProfile setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; return this; }
    public String getApiKeyConfigKey() { return apiKeyConfigKey; }
    public AiModelProfile setApiKeyConfigKey(String apiKeyConfigKey) { this.apiKeyConfigKey = apiKeyConfigKey; return this; }
    public Map<String, Object> getDefaultOptions() { return Map.copyOf(defaultOptions); }
    public AiModelProfile setDefaultOptions(Map<String, Object> defaultOptions) { this.defaultOptions = defaultOptions == null ? new LinkedHashMap<>() : new LinkedHashMap<>(defaultOptions); return this; }
    public Map<String, Object> getLimits() { return Map.copyOf(limits); }
    public AiModelProfile setLimits(Map<String, Object> limits) { this.limits = limits == null ? new LinkedHashMap<>() : new LinkedHashMap<>(limits); return this; }
    public Set<AiCapability> getCapabilities() { return Set.copyOf(capabilities); }
    public AiModelProfile setCapabilities(Set<AiCapability> capabilities) { this.capabilities = capabilities == null ? new LinkedHashSet<>() : new LinkedHashSet<>(capabilities); return this; }
    public boolean isEnabled() { return enabled; }
    public AiModelProfile setEnabled(boolean enabled) { this.enabled = enabled; return this; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public AiModelProfile setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; return this; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public AiModelProfile setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; return this; }
}
