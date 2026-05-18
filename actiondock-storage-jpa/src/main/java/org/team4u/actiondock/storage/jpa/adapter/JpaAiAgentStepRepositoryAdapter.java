package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiAgentStepEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentStepRepository;

import java.util.List;

@Component
public class JpaAiAgentStepRepositoryAdapter implements AiAgentStepRepository {
    private final SpringDataAiAgentStepRepository repository;
    private final JsonCodec jsonCodec;

    public JpaAiAgentStepRepositoryAdapter(SpringDataAiAgentStepRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public AiAgentStep save(AiAgentStep step) {
        return toDomain(repository.save(toEntity(step)));
    }

    @Override
    public List<AiAgentStep> findByRunId(String runId) {
        return repository.findByRunIdOrderByStepIndexAsc(runId).stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteByRunId(String runId) {
        repository.deleteByRunId(runId);
    }

    private AiAgentStepEntity toEntity(AiAgentStep step) {
        AiAgentStepEntity entity = new AiAgentStepEntity();
        entity.setId(step.id());
        entity.setRunId(step.runId());
        entity.setStepIndex(step.stepIndex());
        entity.setStepType(step.stepType() == null ? null : step.stepType().name());
        entity.setModelProfile(step.modelProfile());
        entity.setToolName(step.toolName());
        entity.setToolPermission(step.toolPermission() == null ? null : step.toolPermission().name());
        entity.setToolInputJson(jsonCodec.write(step.toolInput()));
        entity.setToolOutputJson(jsonCodec.write(step.toolOutput()));
        entity.setStatus(step.status());
        entity.setLatencyMs(step.latencyMs());
        entity.setErrorMessage(step.errorMessage());
        entity.setCreatedAt(step.createdAt());
        return entity;
    }

    private AiAgentStep toDomain(AiAgentStepEntity entity) {
        return new AiAgentStep(
                entity.getId(),
                entity.getRunId(),
                entity.getStepIndex(),
                entity.getStepType() == null ? null : AiStepType.valueOf(entity.getStepType()),
                entity.getModelProfile(),
                entity.getToolName(),
                entity.getToolPermission() == null ? null : AiToolPermission.valueOf(entity.getToolPermission()),
                jsonCodec.readMap(entity.getToolInputJson()),
                jsonCodec.readMap(entity.getToolOutputJson()),
                entity.getStatus(),
                entity.getLatencyMs(),
                entity.getErrorMessage(),
                entity.getCreatedAt()
        );
    }
}
