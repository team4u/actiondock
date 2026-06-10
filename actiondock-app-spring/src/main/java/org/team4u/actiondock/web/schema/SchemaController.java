package org.team4u.actiondock.web.schema;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.application.ScriptSchemaSupport;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.Map;

/**
 * 模式（Schema）REST 控制器，提供脚本输入输出模式的摘要查询端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/schema")
public class SchemaController {
    private final ScriptApplicationService scriptApplicationService;

    public SchemaController(ScriptApplicationService scriptApplicationService) {
        this.scriptApplicationService = scriptApplicationService;
    }

    /**
     * 查询脚本的输入输出模式摘要。
     * <p>
     * 返回脚本定义中输入和输出 Schema 的字段列表摘要信息。
     *
     * @param id 脚本 ID
     * @return API 响应，包含模式摘要
     */
    @GetMapping("/{id}")
    public ApiResponse<SchemaResponse> detail(@PathVariable String id) {
        return ApiResponse.success(toResponse(scriptApplicationService.get(id)));
    }

    private SchemaResponse toResponse(ScriptDefinition definition) {
        ScriptSchemaSupport.SchemaSummary inputSummary = ScriptSchemaSupport.summarize(definition.getInputSchema());
        ScriptSchemaSupport.SchemaSummary outputSummary = ScriptSchemaSupport.summarize(definition.getOutputSchema());
        return new SchemaResponse(
                hasSchema(definition.getInputSchema()) ? inputSummary.fields().stream().map(SchemaFieldView::from).toList() : null,
                hasSchema(definition.getOutputSchema()) ? outputSummary.fields().stream().map(SchemaFieldView::from).toList() : null
        );
    }

    private static boolean hasSchema(Map<String, Object> schema) {
        return schema != null && !schema.isEmpty();
    }
}
