package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 不可变的已发布脚本修订。
 */
public class PublishedScriptRevision {
    private String id;
    private String scriptId;
    private Integer version = 1;
    private LocalDateTime publishedAt;
    private String name;
    private ScriptType type = ScriptType.GROOVY;
    private ScriptPackaging packaging = ScriptPackaging.TOOL;
    private String source;
    private String pythonRequirements;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> outputSchema = new LinkedHashMap<>();
    private String owner;
    private String description;
    private List<String> tags = new ArrayList<>();
    private List<ScriptDependency> scriptDependencies = new ArrayList<>();
    private List<PluginDependency> pluginDependencies = new ArrayList<>();
    private List<AiDependency> aiDependencies = new ArrayList<>();

    public PublishedScriptRevision() {
    }

    public PublishedScriptRevision(PublishedScriptRevision other) {
        if (other == null) {
            return;
        }
        setId(other.id);
        setScriptId(other.scriptId);
        setVersion(other.version);
        setPublishedAt(other.publishedAt);
        setName(other.name);
        setType(other.type);
        setPackaging(other.packaging);
        setSource(other.source);
        setPythonRequirements(other.pythonRequirements);
        setInputSchema(other.inputSchema);
        setOutputSchema(other.outputSchema);
        setOwner(other.owner);
        setDescription(other.description);
        setTags(other.tags);
        setScriptDependencies(other.scriptDependencies);
        setPluginDependencies(other.pluginDependencies);
        setAiDependencies(other.aiDependencies);
    }

    public static PublishedScriptRevision fromDraft(ScriptDefinition draft, String revisionId, Integer version, LocalDateTime publishedAt) {
        return new PublishedScriptRevision()
                .setId(revisionId)
                .setScriptId(draft.getId())
                .setVersion(version == null ? 1 : version)
                .setPublishedAt(publishedAt)
                .setName(draft.getName())
                .setType(draft.getType())
                .setPackaging(draft.getPackaging())
                .setSource(draft.getSource())
                .setPythonRequirements(draft.getPythonRequirements())
                .setInputSchema(draft.getInputSchema())
                .setOutputSchema(draft.getOutputSchema())
                .setOwner(draft.getOwner())
                .setDescription(draft.getDescription())
                .setTags(draft.getTags())
                .setScriptDependencies(draft.getScriptDependencies())
                .setPluginDependencies(draft.getPluginDependencies())
                .setAiDependencies(draft.getAiDependencies());
    }

    public String getId() {
        return id;
    }

    public PublishedScriptRevision setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    public PublishedScriptRevision setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public Integer getVersion() {
        return version;
    }

    public PublishedScriptRevision setVersion(Integer version) {
        this.version = version == null ? 1 : version;
        return this;
    }

    public LocalDateTime getPublishedAt() {
        return publishedAt;
    }

    public PublishedScriptRevision setPublishedAt(LocalDateTime publishedAt) {
        this.publishedAt = publishedAt;
        return this;
    }

    public String getName() {
        return name;
    }

    public PublishedScriptRevision setName(String name) {
        this.name = name;
        return this;
    }

    public ScriptType getType() {
        return type;
    }

    public PublishedScriptRevision setType(ScriptType type) {
        this.type = type == null ? ScriptType.GROOVY : type;
        return this;
    }

    public ScriptPackaging getPackaging() {
        return packaging;
    }

    public PublishedScriptRevision setPackaging(ScriptPackaging packaging) {
        this.packaging = packaging == null ? ScriptPackaging.TOOL : packaging;
        return this;
    }

    public String getSource() {
        return source;
    }

    public PublishedScriptRevision setSource(String source) {
        this.source = source;
        return this;
    }

    public String getPythonRequirements() {
        return pythonRequirements;
    }

    public PublishedScriptRevision setPythonRequirements(String pythonRequirements) {
        this.pythonRequirements = pythonRequirements;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return Collections.unmodifiableMap(inputSchema);
    }

    public PublishedScriptRevision setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = SchemaValueCopier.copyMap(inputSchema);
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return Collections.unmodifiableMap(outputSchema);
    }

    public PublishedScriptRevision setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = SchemaValueCopier.copyMap(outputSchema);
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public PublishedScriptRevision setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PublishedScriptRevision setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getTags() {
        return List.copyOf(tags);
    }

    public PublishedScriptRevision setTags(List<String> tags) {
        this.tags = tags == null ? new ArrayList<>() : new ArrayList<>(tags);
        return this;
    }

    public List<ScriptDependency> getScriptDependencies() {
        return SchemaValueCopier.copyList(scriptDependencies, ScriptDependency::copy);
    }

    public PublishedScriptRevision setScriptDependencies(List<ScriptDependency> scriptDependencies) {
        this.scriptDependencies = SchemaValueCopier.copyList(scriptDependencies, ScriptDependency::copy);
        return this;
    }

    public List<PluginDependency> getPluginDependencies() {
        return SchemaValueCopier.copyList(pluginDependencies, PluginDependency::copy);
    }

    public PublishedScriptRevision setPluginDependencies(List<PluginDependency> pluginDependencies) {
        this.pluginDependencies = SchemaValueCopier.copyList(pluginDependencies, PluginDependency::copy);
        return this;
    }

    public List<AiDependency> getAiDependencies() {
        return SchemaValueCopier.copyList(aiDependencies, AiDependency::copy);
    }

    public PublishedScriptRevision setAiDependencies(List<AiDependency> aiDependencies) {
        this.aiDependencies = SchemaValueCopier.copyList(aiDependencies, AiDependency::copy);
        return this;
    }

    public PublishedScriptRevision copy() {
        return new PublishedScriptRevision(this);
    }

    void applyTo(ScriptDefinition target) {
        target.setName(name);
        target.setType(type);
        target.setPackaging(packaging);
        target.setSource(source);
        target.setPythonRequirements(pythonRequirements);
        target.setInputSchema(inputSchema);
        target.setOutputSchema(outputSchema);
        target.setOwner(owner);
        target.setDescription(description);
        target.setTags(tags);
        target.setScriptDependencies(scriptDependencies);
        target.setPluginDependencies(pluginDependencies);
        target.setAiDependencies(aiDependencies);
    }

    public boolean matchesDraft(ScriptDefinition definition) {
        return Objects.equals(name, definition.getName())
                && type == definition.getType()
                && packaging == definition.getPackaging()
                && Objects.equals(source, definition.getSource())
                && Objects.equals(pythonRequirements, definition.getPythonRequirements())
                && Objects.equals(inputSchema, definition.getInputSchema())
                && Objects.equals(outputSchema, definition.getOutputSchema())
                && Objects.equals(owner, definition.getOwner())
                && Objects.equals(description, definition.getDescription())
                && Objects.equals(tags, definition.getTags())
                && Objects.equals(scriptDependencies, definition.getScriptDependencies())
                && Objects.equals(pluginDependencies, definition.getPluginDependencies())
                && Objects.equals(aiDependencies, definition.getAiDependencies());
    }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof PublishedScriptRevision other)) {
            return false;
        }
        return Objects.equals(id, other.id)
                && Objects.equals(scriptId, other.scriptId)
                && Objects.equals(version, other.version)
                && Objects.equals(publishedAt, other.publishedAt)
                && Objects.equals(name, other.name)
                && type == other.type
                && packaging == other.packaging
                && Objects.equals(source, other.source)
                && Objects.equals(pythonRequirements, other.pythonRequirements)
                && Objects.equals(inputSchema, other.inputSchema)
                && Objects.equals(outputSchema, other.outputSchema)
                && Objects.equals(owner, other.owner)
                && Objects.equals(description, other.description)
                && Objects.equals(tags, other.tags)
                && Objects.equals(scriptDependencies, other.scriptDependencies)
                && Objects.equals(pluginDependencies, other.pluginDependencies)
                && Objects.equals(aiDependencies, other.aiDependencies);
    }

    @Override
    public int hashCode() {
        return Objects.hash(
                id,
                scriptId,
                version,
                publishedAt,
                name,
                type,
                packaging,
                source,
                pythonRequirements,
                inputSchema,
                outputSchema,
                owner,
                description,
                tags,
                scriptDependencies,
                pluginDependencies,
                aiDependencies
        );
    }
}
