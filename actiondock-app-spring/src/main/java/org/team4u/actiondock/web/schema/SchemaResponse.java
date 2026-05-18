package org.team4u.actiondock.web.schema;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
/**
 * 模式摘要响应，包含输入和输出字段列表。
 *
 * @author jay.wu
 */
public record SchemaResponse(
        List<SchemaFieldView> input,
        List<SchemaFieldView> output
) {
}
