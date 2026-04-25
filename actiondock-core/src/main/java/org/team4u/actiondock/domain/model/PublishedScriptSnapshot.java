package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
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
    private String source;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> outputSchema = new LinkedHashMap<>();

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
        this.name = other.getName();
        this.type = other.getType();
        this.source = other.getSource();
        this.inputSchema = SchemaValueCopier.copyMap(other.getInputSchema());
        this.outputSchema = SchemaValueCopier.copyMap(other.getOutputSchema());
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

    public String getSource() {
        return source;
    }

    public PublishedScriptSnapshot setSource(String source) {
        this.source = source;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public PublishedScriptSnapshot setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = SchemaValueCopier.copyMap(inputSchema);
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return outputSchema;
    }

    public PublishedScriptSnapshot setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = SchemaValueCopier.copyMap(outputSchema);
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
                && Objects.equals(source, other.source)
                && Objects.equals(inputSchema, other.inputSchema)
                && Objects.equals(outputSchema, other.outputSchema);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, source, inputSchema, outputSchema);
    }
}
