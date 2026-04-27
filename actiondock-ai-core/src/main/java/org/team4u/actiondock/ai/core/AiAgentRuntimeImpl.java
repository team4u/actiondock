package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRecord;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiUsage;
import org.team4u.actiondock.ai.api.AiAgentResumeCommand;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class AiAgentRuntimeImpl implements AiAgentRuntime {
    private final AiAgentProfileService agentProfileService;
    private final AiModelProfileRepository modelProfileRepository;
    private final AiAgentRunRepository runRepository;
    private final AiAgentStepRepository stepRepository;
    private final AiProviderClient providerClient;
    private final AiToolRegistryImpl toolRegistry;

    public AiAgentRuntimeImpl(AiAgentProfileService agentProfileService,
                              AiModelProfileRepository modelProfileRepository,
                              AiAgentRunRepository runRepository,
                              AiAgentStepRepository stepRepository,
                              AiProviderClient providerClient,
                              AiToolRegistryImpl toolRegistry) {
        this.agentProfileService = agentProfileService;
        this.modelProfileRepository = modelProfileRepository;
        this.runRepository = runRepository;
        this.stepRepository = stepRepository;
        this.providerClient = providerClient;
        this.toolRegistry = toolRegistry;
    }

    @Override
    public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
        if (request == null || request.agentProfile() == null || request.agentProfile().isBlank()) {
            throw new IllegalArgumentException("AI Agent Profile 不能为空");
        }
        AiAgentProfile agentProfile = agentProfileService.get(request.agentProfile());
        if (!agentProfile.isEnabled()) {
            throw new IllegalArgumentException("AI Agent Profile 已禁用: " + agentProfile.getId());
        }
        AiModelProfile modelProfile = modelProfileRepository.findById(agentProfile.getModelProfileId())
                .orElseThrow(() -> new IllegalArgumentException("模型 Profile 不存在: " + agentProfile.getModelProfileId()));
        String runId = UUID.randomUUID().toString();
        AiAgentRunContext effectiveContext = withEffectivePolicy(agentProfile, context, runId);
        AiToolPermission maxToolPermission = AiToolPermission.from(effectiveContext.metadata().get("maxToolPermission"), AiToolPermission.READ_ONLY);
        toolRegistry.assertToolsetsAllowed(agentProfile.getToolsetIds(), maxToolPermission);

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

        try {
            AiAgentRunResult result = providerClient.runAgent(agentProfile, modelProfile, request, effectiveContext, toolRegistry);
            List<AiAgentStep> steps = result.steps() == null ? List.of() : result.steps().stream()
                    .map(step -> new AiAgentStep(step.id(), runId, step.stepIndex(), step.stepType(), step.modelProfile(),
                            step.toolName(), step.toolPermission(), step.toolInput(), step.toolOutput(), step.status(),
                            step.latencyMs(), step.errorMessage(), step.createdAt()))
                    .toList();
            steps.forEach(stepRepository::save);
            AiUsage usage = result.usage() == null ? AiUsage.empty() : result.usage();
            int modelCalls = (int) steps.stream().filter(step -> step.stepType() == AiStepType.MODEL_REASONING).count();
            int toolCalls = (int) steps.stream().filter(step -> step.stepType() == AiStepType.TOOL_CALL).count();
            runRepository.save(run
                    .setStatus(result.status() == null ? AiRunStatus.SUCCESS : result.status())
                    .setOutputSummary(result.output())
                    .setTotalModelCalls(modelCalls)
                    .setTotalToolCalls(toolCalls)
                    .setTotalTokens(usage.totalTokens())
                    .setFinishedAt(LocalDateTime.now())
                    .setErrorMessage(result.errorMessage()));
            return new AiAgentRunResult(runId, result.status() == null ? AiRunStatus.SUCCESS : result.status(), result.output(), steps, usage, result.errorMessage());
        } catch (RuntimeException exception) {
            Map<String, Object> output = Map.of("errorMessage", exception.getMessage() == null ? exception.getClass().getName() : exception.getMessage());
            runRepository.save(run
                    .setStatus(AiRunStatus.FAILED)
                    .setOutputSummary(output)
                    .setTotalModelCalls(0)
                    .setTotalToolCalls(0)
                    .setTotalTokens(0)
                    .setFinishedAt(LocalDateTime.now())
                    .setErrorMessage(exception.getMessage()));
            return new AiAgentRunResult(runId, AiRunStatus.FAILED, output, stepRepository.findByRunId(runId), AiUsage.empty(), exception.getMessage());
        }
    }

    @Override
    public AiAgentRunResult resume(String runId, AiAgentResumeCommand command) {
        AiAgentRunRecord run = runRepository.findById(runId)
                .orElseThrow(() -> new IllegalArgumentException("AI Agent Run 不存在: " + runId));
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
        AiAgentRunRecord run = runRepository.findById(runId)
                .orElseThrow(() -> new IllegalArgumentException("AI Agent Run 不存在: " + runId));
        if (run.getStatus() == AiRunStatus.SUCCESS || run.getStatus() == AiRunStatus.FAILED || run.getStatus() == AiRunStatus.CANCELLED) {
            return;
        }
        runRepository.save(run
                .setStatus(AiRunStatus.CANCELLED)
                .setFinishedAt(LocalDateTime.now()));
    }

    @Override
    public AiAgentRunSnapshot getRun(String runId) {
        AiAgentRunRecord run = runRepository.findById(runId)
                .orElseThrow(() -> new IllegalArgumentException("AI Agent Run 不存在: " + runId));
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

    private AiAgentRunContext withEffectivePolicy(AiAgentProfile agentProfile, AiAgentRunContext context, String runId) {
        AiCallerType callerType = context == null || context.callerType() == null ? AiCallerType.ADMIN_TEST : context.callerType();
        Map<String, Object> metadata = new LinkedHashMap<>(context == null || context.metadata() == null ? Map.of() : context.metadata());
        AiToolPermission defaultMax = callerType == AiCallerType.SCRIPT || callerType == AiCallerType.WORKBENCH
                ? AiToolPermission.PROPOSE_CHANGE
                : AiToolPermission.CONTROLLED_ACTION;
        Map<String, Object> policy = agentProfile.getPolicy();
        AiToolPermission profileMax = AiToolPermission.from(policy.get("maxToolPermission"), defaultMax);
        AiToolPermission effectiveMax = min(defaultMax, profileMax);
        if (Boolean.TRUE.equals(policy.get("allowDangerousActions")) && callerType != AiCallerType.SCRIPT) {
            effectiveMax = profileMax == AiToolPermission.DANGEROUS_ACTION ? AiToolPermission.DANGEROUS_ACTION : effectiveMax;
        }
        if (effectiveMax == AiToolPermission.DANGEROUS_ACTION && (callerType == AiCallerType.SCRIPT || callerType == AiCallerType.WORKBENCH)) {
            effectiveMax = AiToolPermission.PROPOSE_CHANGE;
        }
        metadata.put("maxToolPermission", effectiveMax.name());
        metadata.putIfAbsent("dangerousActionsAllowed", effectiveMax == AiToolPermission.DANGEROUS_ACTION);
        metadata.put("agentRunId", runId);
        return new AiAgentRunContext(
                callerType,
                context == null ? null : context.scriptId(),
                context == null ? null : context.executionId(),
                context == null ? null : context.userId(),
                metadata
        );
    }

    private AiToolPermission min(AiToolPermission first, AiToolPermission second) {
        if (first == null) {
            return second == null ? AiToolPermission.READ_ONLY : second;
        }
        if (second == null) {
            return first;
        }
        return first.ordinal() <= second.ordinal() ? first : second;
    }
}
