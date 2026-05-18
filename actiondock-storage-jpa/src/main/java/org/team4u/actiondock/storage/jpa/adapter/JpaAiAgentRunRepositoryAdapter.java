package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.ai.api.AiAgentRunRecord;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiAgentRunEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentRunRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaAiAgentRunRepositoryAdapter implements AiAgentRunRepository {
    private final SpringDataAiAgentRunRepository repository;
    private final JsonCodec jsonCodec;

    public JpaAiAgentRunRepositoryAdapter(SpringDataAiAgentRunRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public AiAgentRunRecord save(AiAgentRunRecord run) {
        return toDomain(repository.save(toEntity(run)));
    }

    @Override
    public Optional<AiAgentRunRecord> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<AiAgentRunRecord> findAll() {
        return repository.findAllByOrderByStartedAtDesc().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private AiAgentRunEntity toEntity(AiAgentRunRecord run) {
        AiAgentRunEntity entity = new AiAgentRunEntity();
        entity.setId(run.getId());
        entity.setAgentProfile(run.getAgentProfile());
        entity.setStatus(run.getStatus() == null ? null : run.getStatus().name());
        entity.setCallerType(run.getCallerType() == null ? null : run.getCallerType().name());
        entity.setScriptId(run.getScriptId());
        entity.setExecutionId(run.getExecutionId());
        entity.setUserId(run.getUserId());
        entity.setInputSummaryJson(jsonCodec.write(run.getInputSummary()));
        entity.setOutputSummaryJson(jsonCodec.write(run.getOutputSummary()));
        entity.setTotalModelCalls(run.getTotalModelCalls());
        entity.setTotalToolCalls(run.getTotalToolCalls());
        entity.setTotalTokens(run.getTotalTokens());
        entity.setStartedAt(run.getStartedAt());
        entity.setFinishedAt(run.getFinishedAt());
        entity.setErrorMessage(run.getErrorMessage());
        return entity;
    }

    private AiAgentRunRecord toDomain(AiAgentRunEntity entity) {
        return new AiAgentRunRecord()
                .setId(entity.getId())
                .setAgentProfile(entity.getAgentProfile())
                .setStatus(entity.getStatus() == null ? null : AiRunStatus.valueOf(entity.getStatus()))
                .setCallerType(entity.getCallerType() == null ? null : AiCallerType.valueOf(entity.getCallerType()))
                .setScriptId(entity.getScriptId())
                .setExecutionId(entity.getExecutionId())
                .setUserId(entity.getUserId())
                .setInputSummary(jsonCodec.readMap(entity.getInputSummaryJson()))
                .setOutputSummary(jsonCodec.readMap(entity.getOutputSummaryJson()))
                .setTotalModelCalls(entity.getTotalModelCalls())
                .setTotalToolCalls(entity.getTotalToolCalls())
                .setTotalTokens(entity.getTotalTokens())
                .setStartedAt(entity.getStartedAt())
                .setFinishedAt(entity.getFinishedAt())
                .setErrorMessage(entity.getErrorMessage());
    }
}
