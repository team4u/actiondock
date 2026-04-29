package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.ai.api.AiCallAction;
import org.team4u.actiondock.ai.api.AiCallLog;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiProvider;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiCallLogEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiCallLogRepository;

import java.util.List;

@Component
public class JpaAiCallLogRepositoryAdapter implements AiCallLogRepository {
    private final SpringDataAiCallLogRepository repository;
    private final JsonCodec jsonCodec;

    public JpaAiCallLogRepositoryAdapter(SpringDataAiCallLogRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public AiCallLog save(AiCallLog log) {
        return toDomain(repository.save(toEntity(log)));
    }

    @Override
    public List<AiCallLog> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    private AiCallLogEntity toEntity(AiCallLog log) {
        AiCallLogEntity entity = new AiCallLogEntity();
        entity.setId(log.getId());
        entity.setExecutionId(log.getExecutionId());
        entity.setScriptId(log.getScriptId());
        entity.setPluginId(log.getPluginId());
        entity.setAgentRunId(log.getAgentRunId());
        entity.setAgentStepId(log.getAgentStepId());
        entity.setCallerType(log.getCallerType() == null ? null : log.getCallerType().name());
        entity.setAction(log.getAction() == null ? null : log.getAction().name());
        entity.setModelProfile(log.getModelProfile());
        entity.setProvider(log.getProvider() == null ? null : log.getProvider().name());
        entity.setModel(log.getModel());
        entity.setStatus(log.getStatus());
        entity.setInputTokens(log.getInputTokens());
        entity.setOutputTokens(log.getOutputTokens());
        entity.setTotalTokens(log.getTotalTokens());
        entity.setLatencyMs(log.getLatencyMs());
        entity.setErrorType(log.getErrorType());
        entity.setErrorMessage(log.getErrorMessage());
        entity.setPromptHash(log.getPromptHash());
        entity.setRequestSummaryJson(jsonCodec.write(log.getRequestSummary()));
        entity.setResponseSummaryJson(jsonCodec.write(log.getResponseSummary()));
        entity.setCreatedAt(log.getCreatedAt());
        return entity;
    }

    private AiCallLog toDomain(AiCallLogEntity entity) {
        return new AiCallLog()
                .setId(entity.getId())
                .setExecutionId(entity.getExecutionId())
                .setScriptId(entity.getScriptId())
                .setPluginId(entity.getPluginId())
                .setAgentRunId(entity.getAgentRunId())
                .setAgentStepId(entity.getAgentStepId())
                .setCallerType(entity.getCallerType() == null ? null : AiCallerType.valueOf(entity.getCallerType()))
                .setAction(entity.getAction() == null ? null : AiCallAction.valueOf(entity.getAction()))
                .setModelProfile(entity.getModelProfile())
                .setProvider(entity.getProvider() == null ? null : AiProvider.valueOf(entity.getProvider()))
                .setModel(entity.getModel())
                .setStatus(entity.getStatus())
                .setInputTokens(entity.getInputTokens())
                .setOutputTokens(entity.getOutputTokens())
                .setTotalTokens(entity.getTotalTokens())
                .setLatencyMs(entity.getLatencyMs())
                .setErrorType(entity.getErrorType())
                .setErrorMessage(entity.getErrorMessage())
                .setPromptHash(entity.getPromptHash())
                .setRequestSummary(jsonCodec.readMap(entity.getRequestSummaryJson()))
                .setResponseSummary(jsonCodec.readMap(entity.getResponseSummaryJson()))
                .setCreatedAt(entity.getCreatedAt());
    }
}
