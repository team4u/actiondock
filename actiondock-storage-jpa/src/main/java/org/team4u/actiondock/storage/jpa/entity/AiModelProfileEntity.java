package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "ai_model_profile")
public class AiModelProfileEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String name;
    @Column(nullable = false)
    private String provider;
    @Column(nullable = false)
    private String modelProvider;
    @Column(nullable = false)
    private String modelName;
    private String baseUrl;
    private String apiKeyConfigKey;
    @Lob
    private String defaultOptionsJson;
    @Lob
    private String limitsJson;
    @Lob
    @Column(nullable = false)
    private String capabilitiesJson;
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }
    public String getModelProvider() { return modelProvider; }
    public void setModelProvider(String modelProvider) { this.modelProvider = modelProvider; }
    public String getModelName() { return modelName; }
    public void setModelName(String modelName) { this.modelName = modelName; }
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    public String getApiKeyConfigKey() { return apiKeyConfigKey; }
    public void setApiKeyConfigKey(String apiKeyConfigKey) { this.apiKeyConfigKey = apiKeyConfigKey; }
    public String getDefaultOptionsJson() { return defaultOptionsJson; }
    public void setDefaultOptionsJson(String defaultOptionsJson) { this.defaultOptionsJson = defaultOptionsJson; }
    public String getLimitsJson() { return limitsJson; }
    public void setLimitsJson(String limitsJson) { this.limitsJson = limitsJson; }
    public String getCapabilitiesJson() { return capabilitiesJson; }
    public void setCapabilitiesJson(String capabilitiesJson) { this.capabilitiesJson = capabilitiesJson; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
