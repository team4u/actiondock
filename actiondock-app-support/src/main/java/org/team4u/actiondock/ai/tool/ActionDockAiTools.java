package org.team4u.actiondock.ai.tool;

import org.team4u.actiondock.common.NormalizeUtils;

import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiSchemaUtils;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.BiFunction;
import java.util.function.Function;

public final class ActionDockAiTools {
    private ActionDockAiTools() {
    }

    public static List<AiTool> create(ScriptRepository scriptRepository,
                                      ExecutionRepository executionRepository,
                                      PluginRegistryRepository pluginRegistryRepository) {
        List<AiTool> all = new ArrayList<>();
        all.addAll(readTools(scriptRepository, executionRepository, pluginRegistryRepository));
        all.addAll(proposalTools());
        return all;
    }

    private static List<AiTool> readTools(ScriptRepository scriptRepo,
                                           ExecutionRepository executionRepo,
                                           PluginRegistryRepository pluginRepo) {
        return List.of(
                tool("get_current_script", "读取当前脚本定义摘要和源码", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of()),
                        objectSchema(Map.of("script", Map.of("type", "object"))),
                        (input, context) -> script(scriptRepo, requireContextScriptId(context), true)),
                tool("get_script", "按脚本 ID 读取脚本定义", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("scriptId", stringSchema(), "includeSource", booleanSchema())),
                        objectSchema(Map.of("script", Map.of("type", "object"))),
                        (input, context) -> script(scriptRepo, string(input.get("scriptId")), booleanValue(input.get("includeSource"), true))),
                tool("list_scripts", "列出脚本摘要，可按关键词过滤", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("keyword", stringSchema())),
                        objectSchema(Map.of("scripts", Map.of("type", "array"))),
                        (input, context) -> listScripts(scriptRepo, string(input.get("keyword")))),
                tool("get_script_schema", "读取脚本输入输出 Schema", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("scriptId", stringSchema())),
                        objectSchema(Map.of("inputSchema", Map.of("type", "object"), "outputSchema", Map.of("type", "object"))),
                        (input, context) -> scriptSchema(scriptRepo, string(input.get("scriptId")))),
                tool("get_execution", "读取执行记录摘要、输入、输出和错误信息", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("executionId", stringSchema())),
                        objectSchema(Map.of("execution", Map.of("type", "object"))),
                        (input, context) -> execution(executionRepo, string(input.get("executionId")), true)),
                tool("get_execution_logs", "读取执行日志", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("executionId", stringSchema())),
                        objectSchema(Map.of("logs", Map.of("type", "array"))),
                        (input, context) -> executionLogs(executionRepo, string(input.get("executionId")))),
                tool("list_plugin_actions", "列出插件及其动作 Schema", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("pluginId", stringSchema())),
                        objectSchema(Map.of("plugins", Map.of("type", "array"))),
                        (input, context) -> listPluginActions(pluginRepo, string(input.get("pluginId")))),
                tool("get_published_revision", "读取脚本已发布修订", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("scriptId", stringSchema())),
                        objectSchema(Map.of("publishedRevision", Map.of("type", "object"))),
                        (input, context) -> publishedRevision(scriptRepo, string(input.get("scriptId"))))
        );
    }

    private static List<AiTool> proposalTools() {
        return List.of(
                tool("propose_script_draft", "生成新脚本草稿提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("id", stringSchema(), "name", stringSchema(), "type", stringSchema(), "source", stringSchema(), "inputSchema", Map.of("type", "object"), "outputSchema", Map.of("type", "object"), "rationale", stringSchema())),
                        objectSchema(Map.of("scriptDraft", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("SCRIPT_DRAFT", "scriptDraft", input)),
                tool("propose_script_patch", "生成脚本源码修改提案，不直接保存；必须提供可直接落地的 updatedSource", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("scriptId", stringSchema(), "patch", stringSchema(), "updatedSource", stringSchema(), "rationale", stringSchema())),
                        objectSchema(Map.of("scriptPatch", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("SCRIPT_PATCH", "scriptPatch", input)),
                tool("propose_schema_patch", "生成 Schema 修改提案，不直接保存；patch 语义为 JSON Merge Patch", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("scriptId", stringSchema(), "inputSchemaPatch", Map.of("type", "object"), "outputSchemaPatch", Map.of("type", "object"), "rationale", stringSchema())),
                        objectSchema(Map.of("schemaPatch", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("SCHEMA_PATCH", "schemaPatch", input)),
                tool("propose_execution_diagnosis", "生成执行失败诊断提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("executionId", stringSchema(), "rootCause", stringSchema(), "evidence", Map.of("type", "array"), "suggestedFix", stringSchema(), "risk", stringSchema(), "nextSteps", Map.of("type", "array"))),
                        objectSchema(Map.of("executionDiagnosis", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("EXECUTION_DIAGNOSIS", "executionDiagnosis", input)),
                tool("propose_execution_fix", "生成执行失败修复建议，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("executionId", stringSchema(), "suggestion", stringSchema(), "rationale", stringSchema())),
                        objectSchema(Map.of("executionDiagnosis", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("EXECUTION_FIX", "executionDiagnosis", input)),
                tool("propose_publish_review", "生成发布前 Review 提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("scriptId", stringSchema(), "summary", stringSchema(), "findings", Map.of("type", "array"), "riskLevel", stringSchema(), "recommendation", stringSchema())),
                        objectSchema(Map.of("publishReview", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("PUBLISH_REVIEW", "publishReview", input)),
                tool("propose_release_notes", "生成发布说明提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("scriptId", stringSchema(), "notes", stringSchema())),
                        objectSchema(Map.of("releaseNotes", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("RELEASE_NOTES", "releaseNotes", input)),
                tool("propose_input_example", "生成输入样例提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("scriptId", stringSchema(), "example", Map.of("type", "object"), "rationale", stringSchema())),
                        objectSchema(Map.of("proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("INPUT_EXAMPLE", "inputExample", input))
        );
    }

    private static AiTool tool(String name,
                               String description,
                               AiToolPermission permission,
                               Map<String, Object> inputSchema,
                               Map<String, Object> outputSchema,
                               BiFunction<Map<String, Object>, AiToolExecutionContext, Map<String, Object>> handler) {
        return new BasicAiTool(name, description, permission, inputSchema, outputSchema, handler);
    }

    private static Map<String, Object> script(ScriptRepository repository, String scriptId, boolean includeSource) {
        ScriptDefinition script = requireScript(repository, scriptId);
        return Map.of("script", scriptMap(script, includeSource));
    }

    private static Map<String, Object> listScripts(ScriptRepository repository, String keyword) {
        String normalized = keyword == null ? "" : keyword.toLowerCase(Locale.ROOT);
        List<Map<String, Object>> scripts = repository.findAll().stream()
                .filter(script -> normalized.isBlank()
                        || contains(script.getId(), normalized)
                        || contains(script.getName(), normalized)
                        || contains(script.getDescription(), normalized))
                .map(script -> scriptMap(script, false))
                .toList();
        return Map.of("scripts", scripts);
    }

    private static Map<String, Object> scriptSchema(ScriptRepository repository, String scriptId) {
        ScriptDefinition script = requireScript(repository, scriptId);
        return Map.of(
                "scriptId", script.getId(),
                "inputSchema", script.getInputSchema(),
                "outputSchema", script.getOutputSchema()
        );
    }

    private static Map<String, Object> execution(ExecutionRepository repository, String executionId, boolean includePayloads) {
        ExecutionRecord record = requireExecution(repository, executionId);
        return Map.of("execution", executionMap(record, includePayloads, true));
    }

    private static Map<String, Object> executionLogs(ExecutionRepository repository, String executionId) {
        ExecutionRecord record = requireExecution(repository, executionId);
        return Map.of(
                "executionId", record.getId(),
                "logs", record.getLogs().stream().map(ActionDockAiTools::logMap).toList()
        );
    }

    private static Map<String, Object> listPluginActions(PluginRegistryRepository repository, String pluginId) {
        List<PluginRegistration> registrations = NormalizeUtils.isBlank(pluginId)
                ? repository.findAll()
                : repository.findByPluginId(pluginId).map(List::of).orElse(List.of());
        return Map.of("plugins", registrations.stream().map(ActionDockAiTools::pluginMap).toList());
    }

    private static Map<String, Object> publishedRevision(ScriptRepository repository, String scriptId) {
        ScriptDefinition script = requireScript(repository, scriptId);
        PublishedScriptRevision revision = script.getPublishedRevision();
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("scriptId", script.getId());
        if (revision == null) {
            values.put("publishedRevision", Map.of());
        } else {
            Map<String, Object> revisionValues = new LinkedHashMap<>();
            revisionValues.put("revisionId", revision.getId());
            revisionValues.put("version", revision.getVersion());
            revisionValues.put("publishedAt", time(revision.getPublishedAt()));
            revisionValues.put("name", value(revision.getName()));
            revisionValues.put("type", revision.getType() == null ? null : revision.getType().name());
            revisionValues.put("packaging", revision.getPackaging() == null ? null : revision.getPackaging().name());
            revisionValues.put("source", value(revision.getSource()));
            revisionValues.put("pythonRequirements", revision.getPythonRequirements());
            revisionValues.put("inputSchema", revision.getInputSchema());
            revisionValues.put("outputSchema", revision.getOutputSchema());
            revisionValues.put("aiDependencies", revision.getAiDependencies());
            values.put("publishedRevision", revisionValues);
        }
        return values;
    }

    private static Map<String, Object> proposal(String type, String resultKey, Map<String, Object> input) {
        Map<String, Object> payload = input == null ? Map.of() : new LinkedHashMap<>(input);
        Map<String, Object> proposal = Map.of(
                "type", type,
                "payload", payload,
                "resultKey", resultKey,
                resultKey, payload,
                "createdAt", LocalDateTime.now().toString(),
                "applied", false
        );
        Map<String, Object> values = new LinkedHashMap<>();
        values.put(resultKey, payload);
        values.put("proposal", proposal);
        return values;
    }

    private static <T> T requireEntity(String id, String entityName, Function<String, Optional<T>> finder) {
        if (NormalizeUtils.isBlank(id)) {
            throw new IllegalArgumentException(entityName + " 不能为空");
        }
        return finder.apply(id)
                .orElseThrow(() -> new IllegalArgumentException(entityName + "不存在: " + id));
    }

    private static ScriptDefinition requireScript(ScriptRepository repository, String scriptId) {
        return requireEntity(scriptId, "scriptId", repository::findById);
    }

    private static ExecutionRecord requireExecution(ExecutionRepository repository, String executionId) {
        return requireEntity(executionId, "executionId", repository::findById);
    }

    private static String requireContextScriptId(AiToolExecutionContext context) {
        if (context == null || NormalizeUtils.isBlank(context.scriptId())) {
            throw new IllegalArgumentException("当前上下文没有关联脚本");
        }
        return context.scriptId();
    }

    private static Map<String, Object> mapOf(Object... keyValuePairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValuePairs.length; i += 2) {
            map.put((String) keyValuePairs[i], keyValuePairs[i + 1]);
        }
        return map;
    }

    private static Map<String, Object> scriptMap(ScriptDefinition script, boolean includeSource) {
        Map<String, Object> values = mapOf(
                "id", script.getId(),
                "name", script.getName(),
                "type", script.getType() == null ? null : script.getType().name(),
                "published", script.hasPublishedRevision(),
                "dirty", script.hasUnpublishedChanges(),
                "version", script.getVersion(),
                "publishedRevisionId", script.getPublishedRevisionId(),
                "publishedAt", time(script.getPublishedAt()),
                "scope", script.getScope() == null ? null : script.getScope().name(),
                "description", script.getDescription(),
                "tags", script.getTags(),
                "pluginDependencies", script.getPluginDependencies(),
                "aiDependencies", script.getAiDependencies(),
                "inputSchema", script.getInputSchema(),
                "outputSchema", script.getOutputSchema(),
                "repositoryId", script.getRepositoryId(),
                "repositoryScriptId", script.getRepositoryScriptId(),
                "updatedAt", time(script.getUpdatedAt())
        );
        if (includeSource) {
            values.put("source", script.getSource());
        }
        return values;
    }

    private static Map<String, Object> executionMap(ExecutionRecord record, boolean includePayloads, boolean includeError) {
        Map<String, Object> values = mapOf(
                "id", record.getId(),
                "scriptId", record.getScriptId(),
                "status", record.getStatus() == null ? null : record.getStatus().name(),
                "submitMode", record.getSubmitMode() == null ? null : record.getSubmitMode().name(),
                "triggerSource", record.getTriggerSource() == null ? null : record.getTriggerSource().name(),
                "scheduleId", record.getScheduleId(),
                "createdAt", time(record.getCreatedAt()),
                "startedAt", time(record.getStartedAt()),
                "finishedAt", time(record.getFinishedAt())
        );
        if (includePayloads) {
            values.put("input", record.getInput());
            values.put("output", record.getOutput());
        }
        if (includeError) {
            values.put("errorMessage", record.getErrorMessage());
            values.put("errorDetail", record.getErrorDetail());
        }
        values.put("logCount", record.getLogs().size());
        return values;
    }

    private static Map<String, Object> logMap(ExecutionLogEntry log) {
        return mapOf(
                "level", log.getLevel() == null ? null : log.getLevel().name(),
                "message", value(log.getMessage()),
                "createdAt", time(log.getCreatedAt())
        );
    }

    private static Map<String, Object> pluginMap(PluginRegistration registration) {
        return mapOf(
                "pluginId", value(registration.getPluginId()),
                "name", value(registration.getName()),
                "version", value(registration.getVersion()),
                "enabled", registration.isEnabled(),
                "actions", registration.getActions().stream().map(ActionDockAiTools::actionMap).toList()
        );
    }

    private static Map<String, Object> actionMap(PluginActionMetadata action) {
        return mapOf(
                "action", value(action.getAction()),
                "title", value(action.getTitle()),
                "description", value(action.getDescription()),
                "inputSchema", action.getInputSchema(),
                "outputSchema", action.getOutputSchema(),
                "exampleArgs", action.getExampleArgs(),
                "aiHints", action.getAiHints()
        );
    }

    private static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return AiSchemaUtils.objectSchema(properties);
    }

    private static Map<String, Object> stringSchema() {
        return AiSchemaUtils.stringSchema();
    }

    private static Map<String, Object> booleanSchema() {
        return AiSchemaUtils.booleanSchema();
    }

    private static boolean contains(String value, String keyword) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(keyword);
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean booleanValue(Object value, boolean fallback) {
        return value instanceof Boolean item ? item : fallback;
    }

    private static String value(String value) {
        return value == null ? "" : value;
    }

    private static String time(LocalDateTime value) {
        return value == null ? null : value.toString();
    }

    private record BasicAiTool(String name,
                               String description,
                               AiToolPermission permission,
                               Map<String, Object> inputSchema,
                               Map<String, Object> outputSchema,
                               BiFunction<Map<String, Object>, AiToolExecutionContext, Map<String, Object>> handler) implements AiTool {
        @Override
        public AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context) {
            long started = System.currentTimeMillis();
            return AiToolExecutionResult.success(handler.apply(input == null ? Map.of() : input, context), System.currentTimeMillis() - started);
        }
    }
}
