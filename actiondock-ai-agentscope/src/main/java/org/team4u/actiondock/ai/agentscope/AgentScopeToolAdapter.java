package org.team4u.actiondock.ai.agentscope;

import com.fasterxml.jackson.core.JsonProcessingException;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.tool.AgentTool;
import io.agentscope.core.tool.ToolCallParam;
import reactor.core.publisher.Mono;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunObserver;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiStepStatus;
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolRegistry;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 将 ActionDock 的 {@link AiTool} 适配为 AgentScope 的 {@link AgentTool}。
 * <p>
 * 负责在工具调用前后记录步骤信息、通知观察者，并将执行结果转换为 AgentScope 所需的 {@link ToolResultBlock}。
 */
class AgentScopeToolAdapter implements AgentTool {

    private static final System.Logger log = System.getLogger(AgentScopeToolAdapter.class.getName());
    private static final String TOOL_EXECUTION_FAILED = "工具执行失败";

    private final AiTool tool;
    private final AiAgentRunRequest request;
    private final AiAgentRunContext context;
    private final AiToolRegistry toolRegistry;
    private final AtomicInteger stepIndex;
    private final List<AiAgentStep> steps;
    private final AiAgentRunObserver observer;

    private AgentScopeToolAdapter(AiTool tool,
                                  AiAgentRunRequest request,
                                  AiAgentRunContext context,
                                  AiToolRegistry toolRegistry,
                                  AtomicInteger stepIndex,
                                  List<AiAgentStep> steps,
                                  AiAgentRunObserver observer) {
        this.tool = tool;
        this.request = request;
        this.context = context;
        this.toolRegistry = toolRegistry;
        this.stepIndex = stepIndex;
        this.steps = steps;
        this.observer = observer;
    }

    /**
     * 将 ActionDock 的 {@link AiTool} 适配为 AgentScope 的 {@link AgentTool}。
     *
     * @param tool         待适配的工具
     * @param request      当前 Agent 运行请求
     * @param context      当前 Agent 运行上下文
     * @param toolRegistry 工具注册表，用于实际执行工具调用
     * @param stepIndex    步骤序号计数器
     * @param steps        步骤收集列表
     * @param observer     运行观察者，用于通知步骤变更
     * @return 适配后的 AgentScope AgentTool 实例
     */
    static AgentTool adapt(AiTool tool,
                           AiAgentRunRequest request,
                           AiAgentRunContext context,
                           AiToolRegistry toolRegistry,
                           AtomicInteger stepIndex,
                           List<AiAgentStep> steps,
                           AiAgentRunObserver observer) {
        return new AgentScopeToolAdapter(tool, request, context, toolRegistry, stepIndex, steps, observer);
    }

    @Override
    public String getName() {
        return tool.name();
    }

    @Override
    public String getDescription() {
        return tool.description();
    }

    @Override
    public Map<String, Object> getParameters() {
        return tool.inputSchema() == null ? Map.of() : tool.inputSchema();
    }

    @Override
    public Mono<ToolResultBlock> callAsync(ToolCallParam param) {
        String stepId = UUID.randomUUID().toString();
        Map<String, Object> input = param == null || param.getInput() == null ? Map.of() : param.getInput();
        AiAgentRunContext effective = context != null ? context : AiAgentRunContext.adminTest();

        AiAgentStep startStep = buildToolStep(
                stepId, AgentScopeAiProviderClient.runId(effective), stepIndex.incrementAndGet(), tool,
                input, Map.of(), AiStepStatus.RUNNING, null, null
        );
        steps.add(startStep);
        observer.onStep(startStep);

        AiToolExecutionResult result = toolRegistry.invoke(tool.name(), input, new AiToolExecutionContext(
                effective.metadata() == null ? null : AgentScopeOptions.toStringOrNull(effective.metadata().get("agentRunId")),
                stepId,
                effective.callerType(),
                effective.scriptId(),
                effective.executionId(),
                effective.userId(),
                toolMetadata(request, effective, param)
        ));

        Map<String, Object> output = result.output() == null ? Map.of() : result.output();
        AiAgentStep resultStep = buildToolStep(
                UUID.randomUUID().toString(), AgentScopeAiProviderClient.runId(effective), stepIndex.incrementAndGet(), tool,
                Map.of(), output, result.success() ? AiStepStatus.SUCCESS : AiStepStatus.FAILED,
                result.latencyMs(), result.errorMessage()
        );
        steps.add(resultStep);
        observer.onStep(resultStep);

        return Mono.just(buildToolResultBlock(result, param, tool));
    }

    private static AiAgentStep buildToolStep(String stepId, String runId, int stepIndex,
                                              AiTool tool,
                                              Map<String, Object> input,
                                              Map<String, Object> output,
                                              String status,
                                              Long latencyMs,
                                              String errorMessage) {
        AiStepType stepType = AiStepStatus.RUNNING.equals(status) ? AiStepType.TOOL_CALL : AiStepType.TOOL_RESULT;
        return new AiAgentStep(
                stepId, runId, stepIndex, stepType, null,
                tool.name(), tool.permission(), input, output,
                status, latencyMs, errorMessage, LocalDateTime.now()
        );
    }

    private static ToolResultBlock buildToolResultBlock(AiToolExecutionResult result,
                                                        ToolCallParam param,
                                                        AiTool tool) {
        Map<String, Object> output = result.output() == null ? Map.of() : result.output();
        String text = result.success() ? toJson(output) : result.errorMessage();
        ToolResultBlock block = result.success()
                ? ToolResultBlock.of(TextBlock.builder().text(text == null ? "" : text).build())
                : ToolResultBlock.error(text == null ? TOOL_EXECUTION_FAILED : text);
        if (param != null && param.getToolUseBlock() != null) {
            block = block.withIdAndName(param.getToolUseBlock().getId(), tool.name());
        }
        return block;
    }

    private static Map<String, Object> toolMetadata(AiAgentRunRequest request, AiAgentRunContext context, ToolCallParam param) {
        Map<String, Object> metadata = new LinkedHashMap<>(context.metadata() == null ? Map.of() : context.metadata());
        metadata.put("agentProfile", request == null ? null : request.agentProfile());
        metadata.put("agentScopeToolCallId", param == null || param.getToolUseBlock() == null ? null : param.getToolUseBlock().getId());
        return metadata;
    }

    private static String toJson(Object value) {
        try {
            return AgentScopeOptions.OBJECT_MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            log.log(System.Logger.Level.WARNING, "JSON 序列化失败，返回空对象: {0}", exception.getMessage());
            return "{}";
        }
    }
}
