package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentResumeCommand;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunObserver;
import org.team4u.actiondock.ai.api.AiAgentRunRecord;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRunSubmission;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiUsage;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

/**
 * AI Agent 运行时实现，负责 Agent 运行的全生命周期管理。
 * <p>
 * 实现 {@link AiAgentRuntime} 接口，支持异步提交（submit）、同步执行（run）、
 * 恢复（resume）和取消（cancel）等操作。运行过程中通过 {@link AiAgentRunObserver}
 * 实时持久化流式文本输出和步骤记录，最终将运行结果（含用量统计和步骤详情）落库。
 *
 * @author jay.wu
 */
public class AiAgentRuntimeImpl implements AiAgentRuntime {

    private final AiAgentProfileService agentProfileService;
    private final AiModelProfileRepository modelProfileRepository;
    private final AiAgentRunRepository runRepository;
    private final AiAgentStepRepository stepRepository;
    private final AiProviderClient providerClient;
    private final AiToolRegistryImpl toolRegistry;
    private final Executor executionExecutor;

    public AiAgentRuntimeImpl(AiAgentProfileService agentProfileService,
                              AiModelProfileRepository modelProfileRepository,
                              AiAgentRunRepository runRepository,
                              AiAgentStepRepository stepRepository,
                              AiProviderClient providerClient,
                              AiToolRegistryImpl toolRegistry) {
        this(agentProfileService, modelProfileRepository, runRepository, stepRepository, providerClient, toolRegistry, Runnable::run);
    }

    public AiAgentRuntimeImpl(AiAgentProfileService agentProfileService,
                              AiModelProfileRepository modelProfileRepository,
                              AiAgentRunRepository runRepository,
                              AiAgentStepRepository stepRepository,
                              AiProviderClient providerClient,
                              AiToolRegistryImpl toolRegistry,
                              Executor executionExecutor) {
        this.agentProfileService = agentProfileService;
        this.modelProfileRepository = modelProfileRepository;
        this.runRepository = runRepository;
        this.stepRepository = stepRepository;
        this.providerClient = providerClient;
        this.toolRegistry = toolRegistry;
        this.executionExecutor = executionExecutor;
    }

    @Override
    public AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
        PreparedRun prepared = prepareRun(request, context, true);
        executionExecutor.execute(() -> executePreparedRun(prepared));
        return new AiAgentRunSubmission(
                prepared.runId(),
                AiRunStatus.RUNNING,
                prepared.agentProfile().getId(),
                prepared.run().getStartedAt()
        );
    }

    @Override
    public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
        return executePreparedRun(prepareRun(request, context, false));
    }

    @Override
    public AiAgentRunResult resume(String runId, AiAgentResumeCommand command) {
        AiAgentRunRecord run = requireRun(runId);
        if (run.getStatus() != AiRunStatus.WAITING_APPROVAL && run.getStatus() != AiRunStatus.INTERRUPTED) {
            throw new IllegalStateException("AI Agent Run 当前状态不可恢复: " + run.getStatus());
        }
        runRepository.save(run
                .setStatus(AiRunStatus.INTERRUPTED)
                .setFinishedAt(LocalDateTime.now())
                .setErrorMessage("Agent resume 需要审批/会话实现，当前 Phase 1 仅保留恢复入口"));
        return new AiAgentRunResult(runId, AiRunStatus.INTERRUPTED, run.getOutputSummary(), stepRepository.findByRunId(runId), AiUsage.empty(), run.getErrorMessage());
    }

    @Override
    public void cancel(String runId) {
        AiAgentRunRecord run = requireRun(runId);
        if (isTerminalStatus(run.getStatus())) {
            return;
        }
        runRepository.save(run
                .setStatus(AiRunStatus.CANCELLED)
                .setFinishedAt(LocalDateTime.now()));
    }

    @Override
    public AiAgentRunSnapshot getRun(String runId) {
        AiAgentRunRecord run = requireRun(runId);
        List<AiAgentStep> steps = stepRepository.findByRunId(runId);
        return new AiAgentRunSnapshot(
                run.getId(),
                run.getAgentProfile(),
                run.getStatus(),
                run.getCallerType(),
                run.getScriptId(),
                run.getExecutionId(),
                run.getUserId(),
                run.getInputSummary(),
                run.getOutputSummary(),
                run.getTotalModelCalls(),
                run.getTotalToolCalls(),
                run.getTotalTokens(),
                run.getStartedAt(),
                run.getFinishedAt(),
                run.getErrorMessage(),
                steps
        );
    }

    public List<AiAgentRunRecord> listRuns() {
        return runRepository.findAll();
    }

    public void deleteRun(String runId) {
        AiAgentRunRecord run = requireRun(runId);
        if (!isTerminalStatus(run.getStatus())) {
            throw new IllegalStateException("运行进行中，无法删除: " + run.getStatus());
        }
        stepRepository.deleteByRunId(runId);
        runRepository.deleteById(runId);
    }

    private PreparedRun prepareRun(AiAgentRunRequest request, AiAgentRunContext context, boolean asyncSubmission) {
        if (request == null || request.agentProfile() == null || request.agentProfile().isBlank()) {
            throw new IllegalArgumentException("AI Agent Profile 不能为空");
        }
        AiAgentProfile agentProfile = agentProfileService.get(request.agentProfile());
        if (!agentProfile.isEnabled()) {
            throw new IllegalArgumentException("AI Agent Profile 已禁用: " + agentProfile.getId());
        }
        AiModelProfile modelProfile = modelProfileRepository.findById(agentProfile.getModelProfileId())
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.AI_MODEL_PROFILE_NOT_FOUND,
                        "模型 Profile 不存在: " + agentProfile.getModelProfileId(),
                        Map.of("profileId", agentProfile.getModelProfileId())
                ));
        String runId = UUID.randomUUID().toString();
        AiAgentRunContext effectiveContext = withEffectivePolicy(agentProfile, context, runId, asyncSubmission);

        AiAgentRunRecord run = new AiAgentRunRecord()
                .setId(runId)
                .setAgentProfile(agentProfile.getId())
                .setStatus(AiRunStatus.RUNNING)
                .setCallerType(effectiveContext.callerType())
                .setScriptId(effectiveContext.scriptId())
                .setExecutionId(effectiveContext.executionId())
                .setUserId(effectiveContext.userId())
                .setInputSummary(Map.of("messageCount", request.messages() == null ? 0 : request.messages().size()))
                .setStartedAt(LocalDateTime.now());
        runRepository.save(run);
        return new PreparedRun(request, agentProfile, modelProfile, effectiveContext, run);
    }

    private AiAgentRunResult executePreparedRun(PreparedRun prepared) {
        return executePreparedRun(prepared, persistenceObserver(prepared.runId()));
    }

    private AiAgentRunResult executePreparedRun(PreparedRun prepared, AiAgentRunObserver observer) {
        try {
            AiAgentRunResult result = providerClient.runAgent(
                    prepared.agentProfile(),
                    prepared.modelProfile(),
                    prepared.request(),
                    prepared.context(),
                    toolRegistry,
                    observer == null ? AiAgentRunObserver.NOOP : observer
            );
            return finalizeSuccess(prepared, result);
        } catch (RuntimeException exception) {
            return finalizeFailure(prepared, exception);
        }
    }

    private AiAgentRunObserver persistenceObserver(String runId) {
        return new AiAgentRunObserver() {
            @Override
            public void onTextDelta(String delta, String accumulatedText) {
                AiAgentRunRecord current = runRepository.findById(runId).orElse(null);
                if (current == null || isTerminalStatus(current.getStatus())) {
                    return;
                }
                Map<String, Object> outputSummary = new LinkedHashMap<>(current.getOutputSummary());
                if (accumulatedText == null || accumulatedText.isBlank()) {
                    outputSummary.remove("text");
                } else {
                    outputSummary.put("text", accumulatedText);
                }
                runRepository.save(current.setOutputSummary(outputSummary));
            }

            @Override
            public void onStep(AiAgentStep step) {
                if (step == null) {
                    return;
                }
                stepRepository.save(withRunId(step, runId));
            }
        };
    }

    private AiAgentRunResult finalizeSuccess(PreparedRun prepared, AiAgentRunResult result) {
        String runId = prepared.runId();
        List<AiAgentStep> steps = normalizeSteps(runId, result == null ? List.of() : result.steps());
        steps.forEach(stepRepository::save);
        List<AiAgentStep> persistedSteps = stepRepository.findByRunId(runId);
        AiUsage usage = result == null || result.usage() == null ? AiUsage.empty() : result.usage();
        AiRunStatus status = result == null || result.status() == null ? AiRunStatus.SUCCESS : result.status();
        Map<String, Object> output = result == null || result.data() == null ? Map.of() : result.data();
        String errorMessage = result == null ? null : result.errorMessage();
        return persistFinalizedRun(prepared, persistedSteps, usage, status, output, errorMessage);
    }

    private AiAgentRunResult finalizeFailure(PreparedRun prepared, RuntimeException exception) {
        String runId = prepared.runId();
        List<AiAgentStep> persistedSteps = stepRepository.findByRunId(runId);
        String errorMessage = exception.getMessage() == null ? exception.getClass().getName() : exception.getMessage();
        Map<String, Object> output = new LinkedHashMap<>();
        AiAgentRunRecord current = runRepository.findById(runId).orElse(prepared.run());
        output.putAll(current.getOutputSummary());
        output.put("errorMessage", errorMessage);
        return persistFinalizedRun(prepared, persistedSteps, AiUsage.empty(), AiRunStatus.FAILED, output, errorMessage);
    }

    /**
     * 持久化最终状态的 Agent 运行记录。
     * <p>
     * 统一处理 CANCELLED 跳过、步骤计数统计、记录保存和结果返回，
     * 消除 finalizeSuccess / finalizeFailure 之间的重复逻辑。
     *
     * @param prepared        预处理的运行上下文
     * @param persistedSteps  已持久化的步骤列表
     * @param usage           模型用量统计
     * @param status          最终状态
     * @param output          输出摘要
     * @param errorMessage    错误信息（成功时为 null）
     * @return 运行结果
     */
    private AiAgentRunResult persistFinalizedRun(PreparedRun prepared,
                                                 List<AiAgentStep> persistedSteps,
                                                 AiUsage usage,
                                                 AiRunStatus status,
                                                 Map<String, Object> output,
                                                 String errorMessage) {
        String runId = prepared.runId();
        AiAgentRunRecord current = runRepository.findById(runId).orElse(prepared.run());
        if (current.getStatus() == AiRunStatus.CANCELLED) {
            return new AiAgentRunResult(runId, AiRunStatus.CANCELLED, current.getOutputSummary(), persistedSteps, usage, current.getErrorMessage());
        }
        runRepository.save(current
                .setStatus(status)
                .setOutputSummary(output)
                .setTotalModelCalls(countSteps(persistedSteps, AiStepType.MODEL_REASONING))
                .setTotalToolCalls(countSteps(persistedSteps, AiStepType.TOOL_CALL))
                .setTotalTokens(usage.totalTokens())
                .setFinishedAt(LocalDateTime.now())
                .setErrorMessage(errorMessage));
        return new AiAgentRunResult(runId, status, output, persistedSteps, usage, errorMessage);
    }

    private static List<AiAgentStep> normalizeSteps(String runId, List<AiAgentStep> steps) {
        if (steps == null || steps.isEmpty()) {
            return List.of();
        }
        return steps.stream().map(step -> withRunId(step, runId)).toList();
    }

    private static AiAgentStep withRunId(AiAgentStep step, String runId) {
        return new AiAgentStep(
                step.id(),
                step.runId() == null ? runId : step.runId(),
                step.stepIndex(),
                step.stepType(),
                step.modelProfile(),
                step.toolName(),
                step.toolPermission(),
                step.toolInput(),
                step.toolOutput(),
                step.status(),
                step.latencyMs(),
                step.errorMessage(),
                step.createdAt()
        );
    }

    private static int countSteps(List<AiAgentStep> steps, AiStepType stepType) {
        return (int) steps.stream().filter(step -> step.stepType() == stepType).count();
    }

    private static boolean isTerminalStatus(AiRunStatus status) {
        return status == AiRunStatus.SUCCESS
                || status == AiRunStatus.FAILED
                || status == AiRunStatus.CANCELLED
                || status == AiRunStatus.INTERRUPTED;
    }

    private AiAgentRunRecord requireRun(String runId) {
        return runRepository.findById(runId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.AI_AGENT_RUN_NOT_FOUND,
                        "AI Agent Run 不存在: " + runId,
                        Map.of("runId", runId)
                ));
    }

    private AiAgentRunContext withEffectivePolicy(AiAgentProfile agentProfile,
                                                  AiAgentRunContext context,
                                                  String runId,
                                                  boolean asyncSubmission) {
        AiAgentRunContext effective = context != null ? context : AiAgentRunContext.adminTest();
        AiCallerType callerType = effective.callerType() != null ? effective.callerType() : AiCallerType.ADMIN_TEST;
        Map<String, Object> metadata = new LinkedHashMap<>(effective.metadata() != null ? effective.metadata() : Map.of());
        metadata.remove("maxToolPermission");
        metadata.remove("dangerousActionsAllowed");
        metadata.put("agentRunId", runId);
        metadata.put(AiAgentRunContext.DISABLE_OUTER_TIMEOUT_METADATA_KEY, asyncSubmission);
        return new AiAgentRunContext(
                callerType,
                effective.scriptId(),
                effective.executionId(),
                effective.userId(),
                metadata
        );
    }

    private record PreparedRun(
            AiAgentRunRequest request,
            AiAgentProfile agentProfile,
            AiModelProfile modelProfile,
            AiAgentRunContext context,
            AiAgentRunRecord run
    ) {
        private String runId() {
            return run.getId();
        }
    }
}
