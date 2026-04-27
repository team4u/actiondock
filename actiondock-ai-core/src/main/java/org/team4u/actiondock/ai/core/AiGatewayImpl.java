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

public class AiGatewayImpl implements AiGateway {
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
        long started = System.currentTimeMillis();
        try {
            AiChatResponse response = providerClient.chat(profile, request, context);
            audit(context, AiCallAction.CHAT, profile, "SUCCESS", response.usage(), System.currentTimeMillis() - started, null, null,
                    summarizeMessages(request == null ? null : request.messages()), Map.of("textLength", response.text() == null ? 0 : response.text().length()));
            return response;
        } catch (RuntimeException exception) {
            audit(context, AiCallAction.CHAT, profile, "FAILED", AiUsage.empty(), System.currentTimeMillis() - started,
                    exception.getClass().getName(), exception.getMessage(), summarizeMessages(request == null ? null : request.messages()), Map.of());
            throw exception;
        }
    }

    @Override
    public AiStructuredResponse structured(AiStructuredRequest request, AiCallContext context) {
        AiModelProfile profile = requireProfile(request == null ? null : request.modelProfile(), AiCapability.STRUCTURED_OUTPUT);
        long started = System.currentTimeMillis();
        try {
            AiStructuredResponse response = providerClient.structured(profile, request, context);
            audit(context, AiCallAction.STRUCTURED, profile, "SUCCESS", response.usage(), System.currentTimeMillis() - started, null, null,
                    summarizeMessages(request == null ? null : request.messages()), Map.of("textLength", response.text() == null ? 0 : response.text().length()));
            return response;
        } catch (RuntimeException exception) {
            audit(context, AiCallAction.STRUCTURED, profile, "FAILED", AiUsage.empty(), System.currentTimeMillis() - started,
                    exception.getClass().getName(), exception.getMessage(), summarizeMessages(request == null ? null : request.messages()), Map.of());
            throw exception;
        }
    }

    @Override
    public AiEmbeddingResponse embed(AiEmbeddingRequest request, AiCallContext context) {
        AiModelProfile profile = requireProfile(request == null ? null : request.modelProfile(), AiCapability.EMBEDDING);
        long started = System.currentTimeMillis();
        try {
            AiEmbeddingResponse response = providerClient.embed(profile, request, context);
            audit(context, AiCallAction.EMBED, profile, "SUCCESS", response.usage(), System.currentTimeMillis() - started, null, null,
                    Map.of("inputCount", request == null || request.input() == null ? 0 : request.input().size()),
                    Map.of("embeddingCount", response.embeddings() == null ? 0 : response.embeddings().size()));
            return response;
        } catch (RuntimeException exception) {
            audit(context, AiCallAction.EMBED, profile, "FAILED", AiUsage.empty(), System.currentTimeMillis() - started,
                    exception.getClass().getName(), exception.getMessage(), Map.of(), Map.of());
            throw exception;
        }
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
        callLogRepository.save(new AiCallLog()
                .setId(UUID.randomUUID().toString())
                .setExecutionId(context == null ? null : context.executionId())
                .setScriptId(context == null ? null : context.scriptId())
                .setPluginId(context == null ? null : context.pluginId())
                .setAgentRunId(context == null ? null : context.agentRunId())
                .setAgentStepId(context == null ? null : context.agentStepId())
                .setCallerType(context == null ? null : context.callerType())
                .setAction(action)
                .setModelProfile(profile.getId())
                .setProvider(profile.getProvider())
                .setModel(profile.getModelName())
                .setStatus(status)
                .setInputTokens(usage == null ? null : usage.inputTokens())
                .setOutputTokens(usage == null ? null : usage.outputTokens())
                .setTotalTokens(usage == null ? null : usage.totalTokens())
                .setLatencyMs(latencyMs)
                .setErrorType(errorType)
                .setErrorMessage(errorMessage)
                .setPromptHash(hash(String.valueOf(requestSummary)))
                .setRequestSummary(requestSummary)
                .setResponseSummary(responseSummary)
                .setCreatedAt(LocalDateTime.now()));
    }

    private Map<String, Object> summarizeMessages(List<?> messages) {
        return Map.of(
                "messageCount", messages == null ? 0 : messages.size(),
                "characters", messages == null ? 0 : messages.toString().length()
        );
    }

    private String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            return null;
        }
    }
}
