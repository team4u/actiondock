package org.team4u.actiondock.ai.tool;

import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.PluginActionMetadata;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiFunction;

public final class ActionDockAiTools {
    private ActionDockAiTools() {
    }

    public static List<AiTool> create(ScriptRepository scriptRepository,
                                      ExecutionRepository executionRepository,
                                      PluginRegistryRepository pluginRegistryRepository) {
        return List.of(
                tool("get_current_script", "读取当前脚本定义摘要和源码", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of()),
                        objectSchema(Map.of("script", Map.of("type", "object"))),
                        (input, context) -> script(scriptRepository, requireContextScriptId(context), true)),
                tool("get_script", "按脚本 ID 读取脚本定义", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("scriptId", stringSchema(), "includeSource", booleanSchema())),
                        objectSchema(Map.of("script", Map.of("type", "object"))),
                        (input, context) -> script(scriptRepository, string(input.get("scriptId")), booleanValue(input.get("includeSource"), true))),
                tool("list_scripts", "列出脚本摘要，可按关键词过滤", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("keyword", stringSchema())),
                        objectSchema(Map.of("scripts", Map.of("type", "array"))),
                        (input, context) -> listScripts(scriptRepository, string(input.get("keyword")))),
                tool("get_script_schema", "读取脚本输入输出 Schema", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("scriptId", stringSchema())),
                        objectSchema(Map.of("inputSchema", Map.of("type", "object"), "outputSchema", Map.of("type", "object"))),
                        (input, context) -> scriptSchema(scriptRepository, string(input.get("scriptId")))),
                tool("get_execution", "读取执行记录摘要、输入、输出和错误信息", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("executionId", stringSchema())),
                        objectSchema(Map.of("execution", Map.of("type", "object"))),
                        (input, context) -> execution(executionRepository, string(input.get("executionId")), true)),
                tool("get_execution_logs", "读取执行日志", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("executionId", stringSchema())),
                        objectSchema(Map.of("logs", Map.of("type", "array"))),
                        (input, context) -> executionLogs(executionRepository, string(input.get("executionId")))),
                tool("list_plugin_actions", "列出插件及其动作 Schema", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("pluginId", stringSchema())),
                        objectSchema(Map.of("plugins", Map.of("type", "array"))),
                        (input, context) -> listPluginActions(pluginRegistryRepository, string(input.get("pluginId")))),
                tool("get_published_snapshot", "读取脚本已发布快照", AiToolPermission.READ_ONLY,
                        objectSchema(Map.of("scriptId", stringSchema())),
                        objectSchema(Map.of("publishedSnapshot", Map.of("type", "object"))),
                        (input, context) -> publishedSnapshot(scriptRepository, string(input.get("scriptId")))),
                tool("propose_script_draft", "生成新脚本草稿提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("id", stringSchema(), "name", stringSchema(), "type", stringSchema(), "source", stringSchema(), "inputSchema", Map.of("type", "object"), "outputSchema", Map.of("type", "object"), "rationale", stringSchema())),
                        objectSchema(Map.of("scriptDraft", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("SCRIPT_DRAFT", "scriptDraft", input)),
                tool("propose_script_patch", "生成脚本源码修改提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
                        objectSchema(Map.of("scriptId", stringSchema(), "patch", stringSchema(), "rationale", stringSchema())),
                        objectSchema(Map.of("scriptPatch", Map.of("type", "object"), "proposal", Map.of("type", "object"))),
                        (input, context) -> proposal("SCRIPT_PATCH", "scriptPatch", input)),
                tool("propose_schema_patch", "生成 Schema 修改提案，不直接保存", AiToolPermission.PROPOSE_CHANGE,
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
        List<PluginRegistration> registrations = pluginId == null || pluginId.isBlank()
                ? repository.findAll()
                : repository.findByPluginId(pluginId).map(List::of).orElse(List.of());
        return Map.of("plugins", registrations.stream().map(ActionDockAiTools::pluginMap).toList());
    }

    private static Map<String, Object> publishedSnapshot(ScriptRepository repository, String scriptId) {
        ScriptDefinition script = requireScript(repository, scriptId);
        PublishedScriptSnapshot snapshot = script.getPublishedSnapshot();
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("scriptId", script.getId());
        if (snapshot == null) {
            values.put("publishedSnapshot", Map.of());
        } else {
            Map<String, Object> snapshotValues = new java.util.LinkedHashMap<>();
            snapshotValues.put("name", value(snapshot.getName()));
            snapshotValues.put("type", snapshot.getType() == null ? null : snapshot.getType().name());
            snapshotValues.put("source", value(snapshot.getSource()));
            snapshotValues.put("inputSchema", snapshot.getInputSchema());
            snapshotValues.put("outputSchema", snapshot.getOutputSchema());
            snapshotValues.put("aiDependencies", snapshot.getAiDependencies());
            values.put("publishedSnapshot", snapshotValues);
        }
        return values;
    }

    private static Map<String, Object> proposal(String type, String resultKey, Map<String, Object> input) {
        Map<String, Object> payload = input == null ? Map.of() : new java.util.LinkedHashMap<>(input);
        Map<String, Object> proposal = Map.of(
                "type", type,
                "payload", payload,
                "resultKey", resultKey,
                resultKey, payload,
                "createdAt", LocalDateTime.now().toString(),
                "applied", false
        );
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put(resultKey, payload);
        values.put("proposal", proposal);
        return values;
    }

    private static ScriptDefinition requireScript(ScriptRepository repository, String scriptId) {
        if (scriptId == null || scriptId.isBlank()) {
            throw new IllegalArgumentException("scriptId 不能为空");
        }
        return repository.findById(scriptId)
                .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + scriptId));
    }

    private static ExecutionRecord requireExecution(ExecutionRepository repository, String executionId) {
        if (executionId == null || executionId.isBlank()) {
            throw new IllegalArgumentException("executionId 不能为空");
        }
        return repository.findById(executionId)
                .orElseThrow(() -> new IllegalArgumentException("执行记录不存在: " + executionId));
    }

    private static String requireContextScriptId(AiToolExecutionContext context) {
        if (context == null || context.scriptId() == null || context.scriptId().isBlank()) {
            throw new IllegalArgumentException("当前上下文没有关联脚本");
        }
        return context.scriptId();
    }

    private static Map<String, Object> scriptMap(ScriptDefinition script, boolean includeSource) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("id", script.getId());
        values.put("name", script.getName());
        values.put("type", script.getType() == null ? null : script.getType().name());
        values.put("status", script.getStatus() == null ? null : script.getStatus().name());
        values.put("version", script.getVersion());
        values.put("scope", script.getScope() == null ? null : script.getScope().name());
        values.put("description", script.getDescription());
        values.put("tags", script.getTags());
        values.put("pluginDependencies", script.getPluginDependencies());
        values.put("aiDependencies", script.getAiDependencies());
        values.put("inputSchema", script.getInputSchema());
        values.put("outputSchema", script.getOutputSchema());
        values.put("repositoryId", script.getRepositoryId());
        values.put("repositoryToolId", script.getRepositoryToolId());
        values.put("updatedAt", time(script.getUpdatedAt()));
        if (includeSource) {
            values.put("source", script.getSource());
        }
        return values;
    }

    private static Map<String, Object> executionMap(ExecutionRecord record, boolean includePayloads, boolean includeError) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("id", record.getId());
        values.put("scriptId", record.getScriptId());
        values.put("status", record.getStatus() == null ? null : record.getStatus().name());
        values.put("submitMode", record.getSubmitMode() == null ? null : record.getSubmitMode().name());
        values.put("triggerSource", record.getTriggerSource() == null ? null : record.getTriggerSource().name());
        values.put("scheduleId", record.getScheduleId());
        values.put("createdAt", time(record.getCreatedAt()));
        values.put("startedAt", time(record.getStartedAt()));
        values.put("finishedAt", time(record.getFinishedAt()));
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
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("level", log.getLevel() == null ? null : log.getLevel().name());
        values.put("message", value(log.getMessage()));
        values.put("createdAt", time(log.getCreatedAt()));
        return values;
    }

    private static Map<String, Object> pluginMap(PluginRegistration registration) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("pluginId", value(registration.getPluginId()));
        values.put("name", value(registration.getName()));
        values.put("version", value(registration.getVersion()));
        values.put("enabled", registration.isEnabled());
        values.put("actions", registration.getActions().stream().map(ActionDockAiTools::actionMap).toList());
        return values;
    }

    private static Map<String, Object> actionMap(PluginActionMetadata action) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put("action", value(action.getAction()));
        values.put("title", value(action.getTitle()));
        values.put("description", value(action.getDescription()));
        values.put("inputSchema", action.getInputSchema());
        values.put("outputSchema", action.getOutputSchema());
        return values;
    }

    private static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return Map.of("type", "object", "properties", properties == null ? Map.of() : properties);
    }

    private static Map<String, Object> stringSchema() {
        return Map.of("type", "string");
    }

    private static Map<String, Object> booleanSchema() {
        return Map.of("type", "boolean");
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
