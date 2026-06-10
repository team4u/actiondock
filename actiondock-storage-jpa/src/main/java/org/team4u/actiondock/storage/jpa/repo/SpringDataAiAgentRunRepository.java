package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.AiAgentRunEntity;

import java.util.List;

public interface SpringDataAiAgentRunRepository extends JpaRepository<AiAgentRunEntity, String> {
    List<AiAgentRunEntity> findAllByOrderByStartedAtDesc();
}
