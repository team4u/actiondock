package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiCallAction;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiCallLog;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingResponse;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiStepStatus;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.ai.api.AiUsage;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * AI 网关实现，提供统一的 AI 模型调用入口。
 * <p>
 * 实现 {@link AiGateway} 接口，封装聊天补全、结构化输出和向量嵌入三种 AI 能力，
 * 并通过 {@link AiProviderClient} 委托给具体的 AI 供应商客户端执行。
 * 每次调用都会自动记录审计日志（含用量统计、延迟、错误信息等）。
 *
 * @author jay.wu
 */
public class AiGatewayImpl implements AiGateway {
    private static final String CALL_STATUS_SUCCESS = AiStepStatus.SUCCESS;
    private static final String CALL_STATUS_FAILED = AiStepStatus.FAILED;

    private final AiModelProfileService modelProfileService;
    private final AiProviderClient providerClient;
    private final AiCallLogRepository callLogRepository;

    public AiGatewayImpl(AiModelProfileService modelProfileService,
                         AiProviderClient providerClient,
                         AiCallLogRepository callLogRepository) {
        this.modelProfileService = modelProfileService;
        this.providerClient = providerClient;
        this.callLogRepository = callLogRepository;
    }

    @Override
    public AiChatResponse chat(AiChatRequest request, AiCallContext context) {
        AiModelProfile profile = requireProfile(request == null ? null : request.modelProfile(), AiCapability.CHAT);
        Map<String, Object> reqSummary = summarizeMessages(request == null ? null : request.messages());
        return executeWithAudit(
                context, AiCallAction.CHAT, profile,
                reqSummary,
                () -> providerClient.chat(profile, request, context),
                response -> Map.of("dataLength", response.data() == null ? 0 : response.data().length()),
                reqSummary
        );
    }

    @Override
    public AiStructuredResponse structured(AiStructuredRequest request, AiCallContext context) {
        AiModelProfile profile = requireProfile(request == null ? null : request.modelProfile(), AiCapability.STRUCTURED_OUTPUT);
        Map<String, Object> reqSummary = summarizeMessages(request == null ? null : request.messages());
        return executeWithAudit(
                context, AiCallAction.STRUCTURED, profile,
                reqSummary,
                () -> providerClient.structured(profile, request, context),
                response -> Map.of("fieldCount", response.data() == null ? 0 : response.data().size()),
                reqSummary
        );
    }

    @Override
    public AiEmbeddingResponse embed(AiEmbeddingRequest request, AiCallContext context) {
        AiModelProfile profile = requireProfile(request == null ? null : request.modelProfile(), AiCapability.EMBEDDING);
        return executeWithAudit(
                context, AiCallAction.EMBED, profile,
                Map.of("inputCount", request == null || request.input() == null ? 0 : request.input().size()),
                () -> providerClient.embed(profile, request, context),
                response -> Map.of("embeddingCount", response.data() == null ? 0 : response.data().size()),
                Map.of()
        );
    }

    /**
     * 通用的执行 + 审计模板方法，封装 try-catch 和审计逻辑。
     *
     * @param context              调用上下文
     * @param action               调用动作类型
     * @param profile              模型配置
     * @param requestSummary       成功时的请求摘要
     * @param invocation           实际调用提供者的逻辑
     * @param responseSummary      响应摘要构建函数
     * @param failedRequestSummary 失败时的请求摘要
     * @param <R>                  响应类型
     * @return 提供者返回的响应
     */
    private <R> R executeWithAudit(AiCallContext context,
                                   AiCallAction action,
                                   AiModelProfile profile,
                                   Map<String, Object> requestSummary,
                                   Supplier<R> invocation,
                                   java.util.function.Function<R, Map<String, Object>> responseSummary,
                                   Map<String, Object> failedRequestSummary) {
        long started = System.currentTimeMillis();
        try {
            R response = invocation.get();
            AiUsage usage = extractUsage(response);
            audit(context, action, profile, CALL_STATUS_SUCCESS, usage, System.currentTimeMillis() - started,
                    null, null, requestSummary, responseSummary.apply(response));
            return response;
        } catch (RuntimeException exception) {
            audit(context, action, profile, CALL_STATUS_FAILED, AiUsage.empty(), System.currentTimeMillis() - started,
                    exception.getClass().getName(), exception.getMessage(),
                    failedRequestSummary, Map.of());
            throw exception;
        }
    }

    /**
     * 从响应对象中提取用量统计。
     */
    private static AiUsage extractUsage(Object response) {
        return switch (response) {
            case AiChatResponse r -> r.usage();
            case AiStructuredResponse r -> r.usage();
            case AiEmbeddingResponse r -> r.usage();
            default -> AiUsage.empty();
        };
    }

    private AiModelProfile requireProfile(String id, AiCapability capability) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("AI 模型 Profile 不能为空");
        }
        AiModelProfile profile = modelProfileService.get(id);
        if (!profile.isEnabled()) {
            throw new IllegalArgumentException("AI 模型 Profile 已禁用: " + id);
        }
        if (!profile.getCapabilities().contains(capability)) {
            throw new IllegalArgumentException("AI 模型 Profile 不支持能力 " + capability + ": " + id);
        }
        return profile;
    }

    private void audit(AiCallContext context,
                       AiCallAction action,
                       AiModelProfile profile,
                       String status,
                       AiUsage usage,
                       long latencyMs,
                       String errorType,
                       String errorMessage,
                       Map<String, Object> requestSummary,
                       Map<String, Object> responseSummary) {
        AiCallLog log = new AiCallLog()
                .setId(UUID.randomUUID().toString());
        applyContext(log, context);
        applyUsage(log, usage);
        callLogRepository.save(log
                .setAction(action)
                .setModelProfile(profile.getId())
                .setProvider(profile.getProvider())
                .setModel(profile.getModelName())
                .setStatus(status)
                .setLatencyMs(latencyMs)
                .setErrorType(errorType)
                .setErrorMessage(errorMessage)
                .setPromptHash(hash(String.valueOf(requestSummary)))
                .setRequestSummary(requestSummary)
                .setResponseSummary(responseSummary)
                .setCreatedAt(LocalDateTime.now()));
    }

    /**
     * 将调用上下文中的字段安全地应用到审计日志。
     * 当 context 为 null 时，所有字段设为 null。
     */
    private static void applyContext(AiCallLog log, AiCallContext context) {
        log.setExecutionId(context == null ? null : context.executionId())
                .setScriptId(context == null ? null : context.scriptId())
                .setPluginId(context == null ? null : context.pluginId())
                .setAgentRunId(context == null ? null : context.agentRunId())
                .setAgentStepId(context == null ? null : context.agentStepId())
                .setCallerType(context == null ? null : context.callerType());
    }

    /**
     * 将用量统计安全地应用到审计日志。
     * 当 usage 为 null 时，所有令牌字段设为 null。
     */
    private static void applyUsage(AiCallLog log, AiUsage usage) {
        log.setInputTokens(usage == null ? null : usage.inputTokens())
                .setOutputTokens(usage == null ? null : usage.outputTokens())
                .setTotalTokens(usage == null ? null : usage.totalTokens());
    }

    private static Map<String, Object> summarizeMessages(List<?> messages) {
        return Map.of(
                "messageCount", messages == null ? 0 : messages.size(),
                "characters", messages == null ? 0 : messages.toString().length()
        );
    }

    private static String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 哈希计算失败", exception);
        }
    }
}
