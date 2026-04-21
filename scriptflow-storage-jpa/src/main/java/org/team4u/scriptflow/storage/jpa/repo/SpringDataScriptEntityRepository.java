package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.scriptflow.storage.jpa.entity.ScriptEntity;

public interface SpringDataScriptEntityRepository extends JpaRepository<ScriptEntity, String> {
}
