package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AiToolset {
    private String id;
    private String name;
    private String description;
    private List<String> toolNames = new ArrayList<>();
    private Map<String, Map<String, Object>> toolOptions = new LinkedHashMap<>();
    private AiToolPermission maxPermission = AiToolPermission.READ_ONLY;
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public AiToolset setId(String id) { this.id = id; return this; }
    public String getName() { return name; }
    public AiToolset setName(String name) { this.name = name; return this; }
    public String getDescription() { return description; }
    public AiToolset setDescription(String description) { this.description = description; return this; }
    public List<String> getToolNames() { return List.copyOf(toolNames); }
    public AiToolset setToolNames(List<String> toolNames) { this.toolNames = toolNames == null ? new ArrayList<>() : new ArrayList<>(toolNames); return this; }
    public Map<String, Map<String, Object>> getToolOptions() { return copyOptions(toolOptions); }
    public AiToolset setToolOptions(Map<String, Map<String, Object>> toolOptions) { this.toolOptions = copyOptions(toolOptions); return this; }
    public AiToolPermission getMaxPermission() { return maxPermission; }
    public AiToolset setMaxPermission(AiToolPermission maxPermission) { this.maxPermission = maxPermission == null ? AiToolPermission.READ_ONLY : maxPermission; return this; }
    public boolean isEnabled() { return enabled; }
    public AiToolset setEnabled(boolean enabled) { this.enabled = enabled; return this; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public AiToolset setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; return this; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public AiToolset setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; return this; }

    private static Map<String, Map<String, Object>> copyOptions(Map<String, Map<String, Object>> source) {
        return AiSchemaUtils.copyOptions(source);
    }
}
