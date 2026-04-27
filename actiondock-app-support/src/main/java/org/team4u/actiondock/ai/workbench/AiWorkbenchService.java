package org.team4u.actiondock.ai.workbench;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AiWorkbenchService {
    private static final Map<AiWorkbenchTaskType, String> RESULT_KEYS = Map.of(
            AiWorkbenchTaskType.GENERATE_SCRIPT, "scriptDraft",
            AiWorkbenchTaskType.IMPROVE_SCRIPT, "scriptPatch",
            AiWorkbenchTaskType.IMPROVE_SCHEMA, "schemaPatch",
            AiWorkbenchTaskType.DIAGNOSE_EXECUTION, "executionDiagnosis",
            AiWorkbenchTaskType.REVIEW_BEFORE_PUBLISH, "publishReview",
            AiWorkbenchTaskType.GENERATE_RELEASE_NOTES, "releaseNotes"
    );

    private final AiAgentRuntime aiAgentRuntime;
    private final ScriptRepository scriptRepository;
    private final ExecutionRepository executionRepository;
    private final ObjectMapper objectMapper;
    private final AiWorkbenchResultParser resultParser;

    public AiWorkbenchService(AiAgentRuntime aiAgentRuntime,
                              ScriptRepository scriptRepository,
                              ExecutionRepository executionRepository,
                              ObjectMapper objectMapper) {
        this.aiAgentRuntime = aiAgentRuntime;
        this.scriptRepository = scriptRepository;
        this.executionRepository = executionRepository;
        this.objectMapper = objectMapper;
        this.resultParser = new AiWorkbenchResultParser(objectMapper);
    }

    public AiWorkbenchResult generateScript(AiWorkbenchCommand command) {
        return run(AiWorkbenchTaskType.GENERATE_SCRIPT, command, null, null);
    }

    public AiWorkbenchResult improveScript(AiWorkbenchCommand command) {
        ScriptDefinition script = requireScript(resolveScriptId(command));
        ExecutionRecord execution = optionalExecutionForScript(script.getId(), command);
        return run(AiWorkbenchTaskType.IMPROVE_SCRIPT, withScriptId(command, script.getId()), script, execution);
    }

    public AiWorkbenchResult improveSchema(AiWorkbenchCommand command) {
        ScriptDefinition script = requireScript(resolveScriptId(command));
        ExecutionRecord execution = optionalExecutionForScript(script.getId(), command);
        return run(AiWorkbenchTaskType.IMPROVE_SCHEMA, withScriptId(command, script.getId()), script, execution);
    }

    public AiWorkbenchResult diagnoseExecution(String executionId, AiWorkbenchCommand command) {
        ExecutionRecord execution = requireExecution(executionId);
        ScriptDefinition script = requireScript(execution.getScriptId());
        return run(AiWorkbenchTaskType.DIAGNOSE_EXECUTION, withExecution(command, script.getId(), execution.getId()), script, execution);
    }

    public AiWorkbenchResult reviewBeforePublish(String scriptId, AiWorkbenchCommand command) {
        ScriptDefinition script = requireScript(scriptId);
        ExecutionRecord execution = optionalExecutionForScript(script.getId(), command);
        return run(AiWorkbenchTaskType.REVIEW_BEFORE_PUBLISH, withScriptId(command, script.getId()), script, execution);
    }

    public AiWorkbenchResult generateReleaseNotes(String scriptId, AiWorkbenchCommand command) {
        ScriptDefinition script = requireScript(scriptId);
        ExecutionRecord execution = optionalExecutionForScript(script.getId(), command);
        return run(AiWorkbenchTaskType.GENERATE_RELEASE_NOTES, withScriptId(command, script.getId()), script, execution);
    }

    private AiWorkbenchResult run(AiWorkbenchTaskType taskType,
                                  AiWorkbenchCommand command,
                                  ScriptDefinition script,
                                  ExecutionRecord execution) {
        AiWorkbenchCommand safeCommand = command == null ? new AiWorkbenchCommand(null, null, null, null, null, Map.of()) : command;
        String agentProfile = resolveAgentProfile(taskType, safeCommand.agentProfile());
        Map<String, Object> input = buildInput(taskType, safeCommand, script, execution);
        AiAgentRunRequest request = new AiAgentRunRequest(agentProfile, buildMessages(taskType, input), input, Map.of("workbenchTaskType", taskType.name()));
        AiAgentRunResult runResult = aiAgentRuntime.run(request, new AiAgentRunContext(
                AiCallerType.WORKBENCH,
                safeCommand.scriptId(),
                safeCommand.executionId(),
                null,
                Map.of("taskType", taskType.name(), "maxToolPermission", "PROPOSE_CHANGE")
        ));
        return toWorkbenchResult(taskType, runResult);
    }

    private AiWorkbenchResult toWorkbenchResult(AiWorkbenchTaskType taskType, AiAgentRunResult runResult) {
        Map<String, Object> rawOutput = runResult.data() == null ? Map.of() : runResult.data();
        String resultKey = RESULT_KEYS.get(taskType);
        Map<String, Object> structured = resultParser.extract(resultKey, rawOutput, runResult);
        AiRunStatus status = runResult.status() == null ? AiRunStatus.SUCCESS : runResult.status();
        String errorMessage = runResult.errorMessage();
        if (status == AiRunStatus.SUCCESS && structured.isEmpty()) {
            status = AiRunStatus.FAILED;
            errorMessage = "Agent 输出缺少预期结构: " + resultKey;
        }
        return new AiWorkbenchResult(
                taskType,
                status,
                structured,
                runResult.runId(),
                runResult.steps() == null ? List.of() : runResult.steps(),
                rawOutput,
                errorMessage
        );
    }

    private Map<String, Object> buildInput(AiWorkbenchTaskType taskType,
                                           AiWorkbenchCommand command,
                                           ScriptDefinition script,
                                           ExecutionRecord execution) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("taskType", taskType.name());
        input.put("objective", value(command.objective()));
        input.put("instructions", value(command.instructions()));
        input.put("context", command.context() == null ? Map.of() : command.context());
        if (script != null) {
            input.put("script", scriptSummary(script));
        }
        if (execution != null) {
            input.put("execution", executionSummary(execution));
        }
        input.put("expectedResultKey", RESULT_KEYS.get(taskType));
        input.put("storagePolicy", "Return proposals only. Do not save, publish, execute, or mutate production data.");
        return input;
    }

    private List<AiMessage> buildMessages(AiWorkbenchTaskType taskType, Map<String, Object> input) {
        String resultKey = RESULT_KEYS.get(taskType);
        List<AiMessage> messages = new ArrayList<>();
        messages.add(new AiMessage("user", """
                Workbench task: %s
                Expected result key: %s
                Use ActionDock tools when script or execution context is needed. Return the proposal through the matching propose_* tool when available.
                If you answer directly, return a single JSON object with the expected result key.
                Input:
                %s
                """.formatted(taskType.name(), resultKey, toJson(input))));
        return messages;
    }

    private String resolveAgentProfile(AiWorkbenchTaskType taskType, String requested) {
        if (requested != null && !requested.isBlank()) {
            return requested;
        }
        return taskType == AiWorkbenchTaskType.DIAGNOSE_EXECUTION
                ? AiWorkbenchDefaults.EXECUTION_DEBUG_AGENT_ID
                : AiWorkbenchDefaults.SCRIPT_DEV_AGENT_ID;
    }

    private ScriptDefinition requireScript(String scriptId) {
        if (scriptId == null || scriptId.isBlank()) {
            throw new IllegalArgumentException("scriptId 不能为空");
        }
        return scriptRepository.findById(scriptId)
                .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + scriptId));
    }

    private ExecutionRecord requireExecution(String executionId) {
        if (executionId == null || executionId.isBlank()) {
            throw new IllegalArgumentException("executionId 不能为空");
        }
        return executionRepository.findById(executionId)
                .orElseThrow(() -> new IllegalArgumentException("执行记录不存在: " + executionId));
    }

    private ExecutionRecord optionalExecutionForScript(String scriptId, AiWorkbenchCommand command) {
        String executionId = command == null ? null : command.executionId();
        if (executionId == null || executionId.isBlank()) {
            return null;
        }
        ExecutionRecord execution = requireExecution(executionId);
        if (!scriptId.equals(execution.getScriptId())) {
            throw new IllegalArgumentException("执行记录不属于脚本: " + executionId);
        }
        return execution;
    }

    private String resolveScriptId(AiWorkbenchCommand command) {
        return command == null ? null : command.scriptId();
    }

    private AiWorkbenchCommand withScriptId(AiWorkbenchCommand command, String scriptId) {
        AiWorkbenchCommand current = command == null ? new AiWorkbenchCommand(null, null, null, null, null, Map.of()) : command;
        return new AiWorkbenchCommand(current.objective(), current.instructions(), current.agentProfile(), scriptId, current.executionId(), current.context());
    }

    private AiWorkbenchCommand withExecution(AiWorkbenchCommand command, String scriptId, String executionId) {
        AiWorkbenchCommand current = command == null ? new AiWorkbenchCommand(null, null, null, null, null, Map.of()) : command;
        return new AiWorkbenchCommand(current.objective(), current.instructions(), current.agentProfile(), scriptId, executionId, current.context());
    }

    private Map<String, Object> scriptSummary(ScriptDefinition script) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("id", script.getId());
        values.put("name", script.getName());
        values.put("type", script.getType() == null ? null : script.getType().name());
        values.put("status", script.getStatus() == null ? null : script.getStatus().name());
        values.put("version", script.getVersion());
        values.put("source", script.getSource());
        values.put("inputSchema", script.getInputSchema());
        values.put("outputSchema", script.getOutputSchema());
        values.put("publishedSnapshot", script.getPublishedSnapshot());
        return values;
    }

    private Map<String, Object> executionSummary(ExecutionRecord execution) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("id", execution.getId());
        values.put("scriptId", execution.getScriptId());
        values.put("status", execution.getStatus() == null ? null : execution.getStatus().name());
        values.put("input", execution.getInput());
        values.put("output", execution.getOutput());
        values.put("errorMessage", execution.getErrorMessage());
        values.put("errorDetail", execution.getErrorDetail());
        values.put("logs", execution.getLogs());
        return values;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ignored) {
            return String.valueOf(value);
        }
    }

    private String value(String value) {
        return value == null ? "" : value;
    }
}
