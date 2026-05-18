package org.team4u.actiondock.ai.tool;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiSchemaUtils;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolProvider;
import org.team4u.actiondock.ai.api.AiToolSourceType;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ObjectValues;
import org.team4u.actiondock.application.ExecutionOutputProjector;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;

import static org.team4u.actiondock.domain.model.ScriptPackaging.MANAGED_INTERNAL_PREFIX;

public class ActionDockDynamicAiToolProvider implements AiToolProvider {
    public static final String SCRIPT_TOOL_PREFIX = "script.";
    public static final String AGENT_TOOL_PREFIX = "agent.";
    static final String AGENT_PROFILE_CHAIN_METADATA_KEY = "agentProfileChain";

    private final ScriptRepository scriptRepository;
    private final AiAgentProfileRepository agentProfileRepository;
    private final Supplier<ExecutionApplicationService> executionApplicationServiceSupplier;
    private final Supplier<AiAgentRuntime> aiAgentRuntimeSupplier;

    public ActionDockDynamicAiToolProvider(ScriptRepository scriptRepository,
                                           AiAgentProfileRepository agentProfileRepository,
                                           Supplier<ExecutionApplicationService> executionApplicationServiceSupplier,
                                           Supplier<AiAgentRuntime> aiAgentRuntimeSupplier) {
        this.scriptRepository = scriptRepository;
        this.agentProfileRepository = agentProfileRepository;
        this.executionApplicationServiceSupplier = executionApplicationServiceSupplier;
        this.aiAgentRuntimeSupplier = aiAgentRuntimeSupplier;
    }

    @Override
    public List<AiTool> listTools() {
        List<AiTool> tools = new ArrayList<>();
        scriptRepository.findAll().stream()
                .filter(ActionDockDynamicAiToolProvider::isPublishedToolScript)
                .sorted(Comparator.comparing(ScriptDefinition::getId))
                .map(PublishedScriptTool::new)
                .forEach(tools::add);
        agentProfileRepository.findAll().stream()
                .filter(ActionDockDynamicAiToolProvider::isVisibleAgentTool)
                .sorted(Comparator.comparing(AiAgentProfile::getId))
                .map(AgentProfileTool::new)
                .forEach(tools::add);
        return List.copyOf(tools);
    }

    @Override
    public Optional<AiTool> findTool(String name) {
        if (NormalizeUtils.isBlank(name)) {
            return Optional.empty();
        }
        return switch (name) {
            case String s when s.startsWith(SCRIPT_TOOL_PREFIX) ->
                    scriptRepository.findById(s.substring(SCRIPT_TOOL_PREFIX.length()))
                            .filter(ActionDockDynamicAiToolProvider::isPublishedToolScript)
                            .map(PublishedScriptTool::new);
            case String s when s.startsWith(AGENT_TOOL_PREFIX) ->
                    agentProfileRepository.findById(s.substring(AGENT_TOOL_PREFIX.length()))
                            .filter(ActionDockDynamicAiToolProvider::isVisibleAgentTool)
                            .map(AgentProfileTool::new);
            default -> Optional.empty();
        };
    }

    private static boolean isPublishedToolScript(ScriptDefinition script) {
        PublishedScriptRevision revision = script == null ? null : script.getPublishedRevision();
        return script != null
                && !script.getId().startsWith(MANAGED_INTERNAL_PREFIX)
                && revision != null
                && revision.getPackaging() == ScriptPackaging.TOOL;
    }

    private static boolean isVisibleAgentTool(AiAgentProfile profile) {
        return profile != null
                && profile.isEnabled()
                && !profile.getId().startsWith(MANAGED_INTERNAL_PREFIX);
    }

    private final class PublishedScriptTool implements AiTool {
        private final ScriptDefinition script;

        private PublishedScriptTool(ScriptDefinition script) {
            this.script = Objects.requireNonNull(script);
        }

        @Override
        public String name() {
            return SCRIPT_TOOL_PREFIX + script.getId();
        }

        @Override
        public String description() {
            String text = NormalizeUtils.normalizeNullable(script.getDescription());
            return text == null
                    ? "调用已发布脚本 " + displayName()
                    : "调用已发布脚本 " + displayName() + "。 " + text;
        }

        @Override
        public AiToolSourceType sourceType() {
            return AiToolSourceType.SCRIPT;
        }

        @Override
        public String sourceId() {
            return script.getId();
        }

        @Override
        public String displayName() {
            return NormalizeUtils.normalizeNullable(script.getName()) == null ? script.getId() : script.getName();
        }

        @Override
        public Map<String, Object> inputSchema() {
            PublishedScriptRevision revision = script.getPublishedRevision();
            return revision == null || revision.getInputSchema() == null ? objectSchema(Map.of()) : revision.getInputSchema();
        }

        @Override
        public Map<String, Object> outputSchema() {
            PublishedScriptRevision revision = script.getPublishedRevision();
            return objectSchema(Map.of(
                    "executionId", stringSchema("脚本执行记录 ID"),
                    "status", stringSchema("脚本执行状态"),
                    "data", revision == null || revision.getOutputSchema() == null ? Map.of("type", "object") : revision.getOutputSchema(),
                    "errorMessage", stringSchema("执行失败时的错误信息")
            ));
        }

        @Override
        public AiToolPermission permission() {
            return AiToolPermission.CONTROLLED_ACTION;
        }

        @Override
        public AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context) {
            long started = System.currentTimeMillis();
            try {
                ExecutionRecord record = executionApplicationServiceSupplier.get().executePublished(
                        script.getId(),
                        input == null ? Map.of() : input,
                        SubmitMode.SYNC,
                        ExecutionTriggerSource.AI_TOOL,
                        null,
                        context == null ? null : context.runId(),
                        context == null ? null : context.stepId()
                );
                ScriptDefinition publishedDefinition = script.toPublishedDefinition();
                Map<String, Object> output = new LinkedHashMap<>();
                output.put("executionId", record.getId());
                output.put("status", record.getStatus().name());
                output.put("data", ExecutionOutputProjector.project(record.getOutput(), publishedDefinition.getOutputSchema()));
                output.put("errorMessage", record.getErrorMessage());
                if (record.getStatus() == org.team4u.actiondock.domain.model.ExecutionStatus.FAILED) {
                    return new AiToolExecutionResult(false, output, record.getErrorMessage(), System.currentTimeMillis() - started);
                }
                return AiToolExecutionResult.success(output, System.currentTimeMillis() - started);
            } catch (RuntimeException exception) {
                return toErrorResult("executionId", started, exception);
            }
        }
    }

    private final class AgentProfileTool implements AiTool {
        private final AiAgentProfile agentProfile;

        private AgentProfileTool(AiAgentProfile agentProfile) {
            this.agentProfile = Objects.requireNonNull(agentProfile);
        }

        @Override
        public String name() {
            return AGENT_TOOL_PREFIX + agentProfile.getId();
        }

        @Override
        public String description() {
            String text = NormalizeUtils.normalizeNullable(agentProfile.getDescription());
            return text == null
                    ? "调用已启用 Agent " + displayName() + "，输入统一为 message + input。"
                    : "调用已启用 Agent " + displayName() + "。 " + text;
        }

        @Override
        public AiToolSourceType sourceType() {
            return AiToolSourceType.AGENT;
        }

        @Override
        public String sourceId() {
            return agentProfile.getId();
        }

        @Override
        public String displayName() {
            return NormalizeUtils.normalizeNullable(agentProfile.getName()) == null ? agentProfile.getId() : agentProfile.getName();
        }

        @Override
        public Map<String, Object> inputSchema() {
            return objectSchema(Map.of(
                    "message", stringSchema("发送给子 Agent 的任务消息"),
                    "input", Map.of("type", "object", "description", "发送给子 Agent 的结构化输入")
            ));
        }

        @Override
        public Map<String, Object> outputSchema() {
            return objectSchema(Map.of(
                    "runId", stringSchema("子 Agent Run ID"),
                    "status", stringSchema("子 Agent 运行状态"),
                    "data", Map.of("type", "object"),
                    "errorMessage", stringSchema("子 Agent 失败时的错误信息")
            ));
        }

        @Override
        public AiToolPermission permission() {
            return AiToolPermission.CONTROLLED_ACTION;
        }

        @Override
        public AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context) {
            long started = System.currentTimeMillis();
            try {
                String message = requireMessage(input);
                List<String> chain = agentProfileChain(context);
                checkRecursiveChain(chain);
                Map<String, Object> metadata = buildChainMetadata(context, chain);

                AiAgentRunResult result = aiAgentRuntimeSupplier.get().run(
                        buildRunRequest(message, input),
                        buildRunContext(context, metadata)
                );

                return toAgentResult(result, started);
            } catch (RuntimeException exception) {
                return toErrorResult("runId", started, exception);
            }
        }

        private String requireMessage(Map<String, Object> input) {
            String message = ObjectValues.stringValue(input == null ? null : input.get("message"));
            if (NormalizeUtils.isBlank(message)) {
                throw new IllegalArgumentException("message 不能为空");
            }
            return message;
        }

        private void checkRecursiveChain(List<String> chain) {
            if (chain.contains(agentProfile.getId())) {
                throw new IllegalStateException("检测到 Agent 工具递归调用链: " + String.join(" -> ", append(chain, agentProfile.getId())));
            }
        }

        private Map<String, Object> buildChainMetadata(AiToolExecutionContext context, List<String> chain) {
            Map<String, Object> metadata = new LinkedHashMap<>(context == null || context.metadata() == null ? Map.of() : context.metadata());
            metadata.put(AGENT_PROFILE_CHAIN_METADATA_KEY, append(chain, agentProfile.getId()));
            return metadata;
        }

        @SuppressWarnings("unchecked")
        private AiAgentRunRequest buildRunRequest(String message, Map<String, Object> input) {
            Map<String, Object> structuredInput = input != null && input.get("input") instanceof Map<?, ?> map
                    ? new LinkedHashMap<>((Map<String, Object>) map)
                    : Map.of();
            return new AiAgentRunRequest(
                    agentProfile.getId(),
                    List.of(new AiMessage("user", message)),
                    structuredInput,
                    Map.of()
            );
        }

        private AiAgentRunContext buildRunContext(AiToolExecutionContext context, Map<String, Object> metadata) {
            return new AiAgentRunContext(
                    AiCallerType.AGENT,
                    context == null ? null : context.scriptId(),
                    context == null ? null : context.executionId(),
                    context == null ? null : context.userId(),
                    metadata
            );
        }

        private AiToolExecutionResult toAgentResult(AiAgentRunResult result, long started) {
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("runId", result.runId());
            output.put("status", result.status() == null ? AiRunStatus.SUCCESS.name() : result.status().name());
            output.put("data", result.data() == null ? Map.of() : result.data());
            output.put("errorMessage", result.errorMessage());
            if (result.status() != AiRunStatus.SUCCESS) {
                String errorMessage = result.errorMessage() == null ? "子 Agent 执行失败: " + output.get("status") : result.errorMessage();
                return new AiToolExecutionResult(false, output, errorMessage, System.currentTimeMillis() - started);
            }
            return AiToolExecutionResult.success(output, System.currentTimeMillis() - started);
        }
    }

    private static List<String> agentProfileChain(AiToolExecutionContext context) {
        List<String> chain = new ArrayList<>();
        if (context != null && context.metadata() != null) {
            Object existing = context.metadata().get(AGENT_PROFILE_CHAIN_METADATA_KEY);
            if (existing instanceof List<?> list) {
                list.stream().map(String::valueOf).forEach(chain::add);
            }
            String parentAgentProfile = ObjectValues.stringValue(context.metadata().get("agentProfile"));
            if (NormalizeUtils.isNotBlank(parentAgentProfile) && !chain.contains(parentAgentProfile)) {
                chain.add(parentAgentProfile);
            }
        }
        return List.copyOf(chain);
    }

    private static List<String> append(List<String> values, String next) {
        List<String> result = new ArrayList<>(NormalizeUtils.nullSafeList(values));
        result.add(next);
        return List.copyOf(result);
    }

    private static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return AiSchemaUtils.objectSchema(properties);
    }

    private static Map<String, Object> stringSchema(String description) {
        return AiSchemaUtils.stringSchema(description);
    }

    private static AiToolExecutionResult toErrorResult(String idKey, long started, RuntimeException exception) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put(idKey, null);
        output.put("status", AiRunStatus.FAILED.name());
        output.put("data", Map.of());
        output.put("errorMessage", exception.getMessage());
        return new AiToolExecutionResult(false, output, exception.getMessage(), System.currentTimeMillis() - started);
    }

}
