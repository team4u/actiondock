package org.team4u.actiondock.domain.model;

import java.util.Collections;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 已发布脚本的快照，记录脚本发布时的完整状态。
 * <p>
 * 快照包含脚本的名称、类型、源代码和输入输出模式。
 * 用于保存和恢复已发布的脚本版本，确保历史版本的可追溯性。
 *
 * @author jay.wu
 */
public class PublishedScriptSnapshot {
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

    public PublishedScriptSnapshot() {
    }

    /**
     * 拷贝构造函数，基于另一个快照创建新实例。
     *
     * @param other 要拷贝的源快照
     */
    public PublishedScriptSnapshot(PublishedScriptSnapshot other) {
        if (other == null) {
            return;
        }
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

    public String getName() {
        return name;
    }

    public PublishedScriptSnapshot setName(String name) {
        this.name = name;
        return this;
    }

    public ScriptType getType() {
        return type;
    }

    public PublishedScriptSnapshot setType(ScriptType type) {
        this.type = type == null ? ScriptType.GROOVY : type;
        return this;
    }

    public ScriptPackaging getPackaging() {
        return packaging;
    }

    public PublishedScriptSnapshot setPackaging(ScriptPackaging packaging) {
        this.packaging = packaging == null ? ScriptPackaging.TOOL : packaging;
        return this;
    }

    public String getSource() {
        return source;
    }

    public PublishedScriptSnapshot setSource(String source) {
        this.source = source;
        return this;
    }

    public String getPythonRequirements() {
        return pythonRequirements;
    }

    public PublishedScriptSnapshot setPythonRequirements(String pythonRequirements) {
        this.pythonRequirements = pythonRequirements;
        return this;
    }

    /**
     * 获取输入模式的不可变视图。
     *
     * @return 输入模式的不可变映射
     */
    public Map<String, Object> getInputSchema() {
        return Collections.unmodifiableMap(inputSchema);
    }

    public PublishedScriptSnapshot setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = SchemaValueCopier.copyMap(inputSchema);
        return this;
    }

    /**
     * 获取输出模式的不可变视图。
     *
     * @return 输出模式的不可变映射
     */
    public Map<String, Object> getOutputSchema() {
        return Collections.unmodifiableMap(outputSchema);
    }

    public PublishedScriptSnapshot setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = SchemaValueCopier.copyMap(outputSchema);
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public PublishedScriptSnapshot setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PublishedScriptSnapshot setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getTags() {
        return List.copyOf(tags);
    }

    public PublishedScriptSnapshot setTags(List<String> tags) {
        this.tags = tags == null ? new ArrayList<>() : new ArrayList<>(tags);
        return this;
    }

    public List<ScriptDependency> getScriptDependencies() {
        return SchemaValueCopier.copyList(scriptDependencies, ScriptDependency::copy);
    }

    public PublishedScriptSnapshot setScriptDependencies(List<ScriptDependency> scriptDependencies) {
        this.scriptDependencies = SchemaValueCopier.copyList(scriptDependencies, ScriptDependency::copy);
        return this;
    }

    public List<PluginDependency> getPluginDependencies() {
        return SchemaValueCopier.copyList(pluginDependencies, PluginDependency::copy);
    }

    public PublishedScriptSnapshot setPluginDependencies(List<PluginDependency> pluginDependencies) {
        this.pluginDependencies = SchemaValueCopier.copyList(pluginDependencies, PluginDependency::copy);
        return this;
    }

    public List<AiDependency> getAiDependencies() {
        return SchemaValueCopier.copyList(aiDependencies, AiDependency::copy);
    }

    public PublishedScriptSnapshot setAiDependencies(List<AiDependency> aiDependencies) {
        this.aiDependencies = SchemaValueCopier.copyList(aiDependencies, AiDependency::copy);
        return this;
    }

    /**
     * 创建当前快照的深拷贝。
     *
     * @return 新的快照实例，包含相同的数据
     */
    public PublishedScriptSnapshot copy() {
        return new PublishedScriptSnapshot(this);
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

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof PublishedScriptSnapshot other)) {
            return false;
        }
        return Objects.equals(name, other.name)
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
