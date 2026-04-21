package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.scriptflow.storage.jpa.entity.ExecutionEntity;

import java.util.List;

public interface SpringDataExecutionEntityRepository extends JpaRepository<ExecutionEntity, String> {
    List<ExecutionEntity> findByScriptIdOrderByCreatedAtDesc(String scriptId);
}
