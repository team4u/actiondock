package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.AiAgentStepEntity;

import java.util.List;

public interface SpringDataAiAgentStepRepository extends JpaRepository<AiAgentStepEntity, String> {
    List<AiAgentStepEntity> findByRunIdOrderByStepIndexAsc(String runId);
    void deleteByRunId(String runId);
}
