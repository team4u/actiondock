package org.team4u.actiondock.web;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.*;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.schedule.ScriptScheduleDispatcher;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 脚本管理 REST 控制器，提供脚本定义的 CRUD、发布和执行端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/scripts")
public class ScriptController {
    private static final List<String> ALLOWED_PATCH_FIELDS = List.of("source", "pythonRequirements", "inputSchema", "outputSchema");
    private static final Set<String> ALLOWED_PATCH_FIELD_SET = Set.copyOf(ALLOWED_PATCH_FIELDS);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final ScriptApplicationService scriptApplicationService;
    private final ExecutionApplicationService executionApplicationService;
    private final ScriptScheduleDispatcher scriptScheduleDispatcher;
    private final ExecutionResponseMapper executionResponseMapper;
    private final RepositoryCatalogService repositoryCatalogService;
    private final ObjectMapper objectMapper;

    public ScriptController(ScriptApplicationService scriptApplicationService,
                            ExecutionApplicationService executionApplicationService,
                            ScriptScheduleDispatcher scriptScheduleDispatcher,
                            RepositoryCatalogService repositoryCatalogService,
                            ObjectMapper objectMapper,
                            ExecutionResponseMapper executionResponseMapper) {
        this.scriptApplicationService = scriptApplicationService;
        this.executionApplicationService = executionApplicationService;
        this.scriptScheduleDispatcher = scriptScheduleDispatcher;
        this.repositoryCatalogService = repositoryCatalogService;
        this.objectMapper = objectMapper;
        this.executionResponseMapper = executionResponseMapper;
    }

    /**
     * 查询所有脚本定义列表。
     *
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含脚本定义列表
     */
    @GetMapping
    public ApiResponse<List<ScriptDefinition>> list(@RequestParam(defaultValue = "false") boolean includeUiSchema,
                                                    @RequestParam(defaultValue = "false") boolean includeManaged) {
        return ApiResponse.success(scriptApplicationService.list(includeManaged).stream()
                .map(definition -> toResponse(definition, includeUiSchema))
                .toList());
    }

    /**
     * 新建或更新脚本定义。
     *
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param definition 脚本定义内容
     * @return API 响应，包含保存后的脚本定义
     */
    @PostMapping
    public ApiResponse<ScriptDefinition> save(
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    /**
     * 查询脚本定义详情（草稿版本）。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含脚本定义
     */
    @GetMapping("/{id}")
    public ApiResponse<ScriptDefinition> detail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.get(id), includeUiSchema));
    }

    /**
     * 查询已发布的脚本定义详情。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含已发布的脚本快照
     */
    @GetMapping("/{id}/published")
    public ApiResponse<ScriptDefinition> publishedDetail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.getPublished(id), includeUiSchema));
    }

    /**
     * 更新已有脚本定义。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param definition 更新后的脚本定义内容
     * @return API 响应，包含更新后的脚本定义
     */
    @PutMapping("/{id}")
    public ApiResponse<ScriptDefinition> update(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        definition.setId(id);
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    @PatchMapping("/{id}")
    public ApiResponse<ScriptDefinition> patch(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody(required = false) Map<String, Object> patch
    ) {
        ScriptDefinition existing = scriptApplicationService.get(id);
        validatePatchFields(id, patch);

        ScriptDefinition updated = objectMapper.convertValue(existing, ScriptDefinition.class);
        Map<String, Object> safePatch = patch == null ? Map.of() : patch;
        if (safePatch.containsKey("source")) {
            applySourcePatch(updated, safePatch.get("source"));
        }
        if (safePatch.containsKey("pythonRequirements")) {
            applyPythonRequirementsPatch(updated, safePatch.get("pythonRequirements"));
        }
        if (safePatch.containsKey("inputSchema")) {
            updated.setInputSchema(applySchemaPatch(existing.getInputSchema(), safePatch.get("inputSchema"), "inputSchema"));
        }
        if (safePatch.containsKey("outputSchema")) {
            updated.setOutputSchema(applySchemaPatch(existing.getOutputSchema(), safePatch.get("outputSchema"), "outputSchema"));
        }
        return ApiResponse.success(toResponse(scriptApplicationService.save(updated), includeUiSchema));
    }

    /**
     * 删除脚本定义及其关联的定时调度。
     *
     * @param id 脚本 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        scriptApplicationService.delete(id);
        scriptScheduleDispatcher.refreshScript(id);
        return ApiResponse.success(null);
    }

    /**
     * 校验脚本草稿的合法性。
     *
     * @param id 脚本 ID
     * @return API 响应，校验通过时无数据
     */
    @PostMapping("/{id}/validate")
    public ApiResponse<Void> validate(@PathVariable String id) {
        scriptApplicationService.validate(id);
        return ApiResponse.success(null, "校验通过");
    }

    /**
     * 发布脚本草稿，将当前草稿内容保存为已发布快照。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含发布后的脚本定义
     */
    @PostMapping("/{id}/publish")
    public ApiResponse<ScriptDefinition> publish(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.publish(id), includeUiSchema), "发布成功");
    }

    /**
     * 丢弃脚本草稿，恢复为已发布快照的内容。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含恢复后的脚本定义
     */
    @PostMapping("/{id}/discard-draft")
    public ApiResponse<ScriptDefinition> discardDraft(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.discardDraft(id), includeUiSchema), "草稿已丢弃");
    }

    /**
     * 执行已发布的脚本。
     * <p>
     * 根据脚本 ID 查找已发布的版本并执行，返回执行结果。
     *
     * @param id 脚本 ID
     * @param request 执行请求，包含输入参数和执行模式
     * @return API 响应，包含执行结果
     */
    @PostMapping("/{id}/published/execute")
    public ApiResponse<ExecutionResponse> executePublished(@PathVariable String id, @RequestBody ExecuteRequest request) {
        ExecutionRecord record = executionApplicationService.executePublished(id, request.getInput(), request.getMode());
        ScriptDefinition scriptDefinition = scriptApplicationService.getPublished(id);
        return ApiResponse.success(
                executionResponseMapper.toResponse(record, scriptDefinition, request.getResponseView()),
                "已受理"
        );
    }

    /**
     * Fork 指定脚本到当前命名空间。
     *
     * @param id 原始脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param request Fork 请求，包含目标 ID 和名称
     * @return API 响应，包含 Fork 后的脚本定义
     */
    @PostMapping("/{id}/fork")
    public ApiResponse<ScriptDefinition> fork(@PathVariable String id,
                                              @RequestParam(defaultValue = "false") boolean includeUiSchema,
                                              @RequestBody RepositoryForkRequest request) {
        return ApiResponse.success(
                toResponse(scriptApplicationService.createFork(id, request.getId(), request.getName()), includeUiSchema),
                "Fork 创建成功"
        );
    }

    @GetMapping("/{id}/development-status")
    public ApiResponse<RepositoryCatalogService.DevelopmentStatus> developmentStatus(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.getDevelopmentStatus(id));
    }

    @PostMapping("/{id}/development-pull")
    public ApiResponse<ScriptDefinition> developmentPull(@PathVariable String id,
                                                         @RequestParam(defaultValue = "false") boolean force,
                                                         @RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(
                toResponse(repositoryCatalogService.pullDevelopmentScript(id, force), includeUiSchema),
                "开发脚本已拉取远端更新"
        );
    }

    private ScriptDefinition toResponse(ScriptDefinition definition, boolean includeUiSchema) {
        return includeUiSchema ? definition : SchemaViewSanitizer.sanitize(definition);
    }

    private void validatePatchFields(String scriptId, Map<String, Object> patch) {
        if (patch == null || patch.isEmpty()) {
            return;
        }
        List<String> rejectedFields = patch.keySet().stream()
                .filter(field -> !ALLOWED_PATCH_FIELD_SET.contains(field))
                .sorted()
                .toList();
        if (!rejectedFields.isEmpty()) {
            throw new InvalidScriptPatchException(scriptId, rejectedFields, ALLOWED_PATCH_FIELDS);
        }
    }

    private void applySourcePatch(ScriptDefinition definition, Object value) {
        if (value != null && !(value instanceof String)) {
            throw new IllegalArgumentException("source 必须是字符串或 null");
        }
        definition.setSource((String) value);
    }

    private void applyPythonRequirementsPatch(ScriptDefinition definition, Object value) {
        if (value != null && !(value instanceof String)) {
            throw new IllegalArgumentException("pythonRequirements 必须是字符串或 null");
        }
        definition.setPythonRequirements((String) value);
    }

    private Map<String, Object> applySchemaPatch(Map<String, Object> currentValue, Object patchValue, String fieldName) {
        if (patchValue == null) {
            return Map.of();
        }
        JsonNode patchNode = objectMapper.valueToTree(patchValue);
        if (!patchNode.isObject()) {
            throw new IllegalArgumentException(fieldName + " 必须是对象或 null");
        }
        JsonNode currentNode = objectMapper.valueToTree(currentValue == null ? Map.of() : currentValue);
        JsonNode mergedNode = applyMergePatch(currentNode, patchNode);
        Map<String, Object> merged = objectMapper.convertValue(mergedNode, MAP_TYPE);
        return merged == null ? Map.of() : merged;
    }

    private JsonNode applyMergePatch(JsonNode target, JsonNode patch) {
        if (patch == null || patch.isNull()) {
            return objectMapper.nullNode();
        }
        if (!patch.isObject()) {
            return patch.deepCopy();
        }

        JsonNode normalizedTarget = target != null && target.isObject()
                ? target.deepCopy()
                : objectMapper.createObjectNode();
        com.fasterxml.jackson.databind.node.ObjectNode result = (com.fasterxml.jackson.databind.node.ObjectNode) normalizedTarget;
        patch.fields().forEachRemaining(entry -> {
            String fieldName = entry.getKey();
            JsonNode patchValue = entry.getValue();
            if (patchValue == null || patchValue.isNull()) {
                result.remove(fieldName);
                return;
            }
            JsonNode targetValue = result.get(fieldName);
            result.set(fieldName, applyMergePatch(targetValue, patchValue));
        });
        return result;
    }
}
