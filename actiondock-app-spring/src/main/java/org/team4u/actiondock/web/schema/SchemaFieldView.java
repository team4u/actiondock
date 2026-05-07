package org.team4u.actiondock.web.schema;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.team4u.actiondock.application.ScriptSchemaSupport;

import java.util.List;

@JsonInclude(JsonInclude.Include.NON_EMPTY)
/**
 * 模式字段视图，展示单个字段的元信息。
 *
 * @author jay.wu
 */
public record SchemaFieldView(
        String name,
        String label,
        String kind,
        Boolean required,
        String description,
        List<String> enumValues,
        Object defaultValue,
        List<Object> examples
) {
    /**
     * 从内部 Schema 字段模型转换为视图对象。
     * <p>
     * 当 required 为 false 时转为 null，配合 JsonInclude.NON_EMPTY 省略输出。
     *
     * @param field 内部 Schema 字段
     * @return Schema 字段视图
     */
    public static SchemaFieldView from(ScriptSchemaSupport.SchemaField field) {
        return new SchemaFieldView(
                field.name(),
                field.label(),
                field.kind(),
                field.required() ? Boolean.TRUE : null,
                field.description(),
                field.enumValues(),
                field.defaultValue(),
                field.examples()
        );
    }
}
