package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;

/**
 * Spring Data JPA 脚本实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataScriptEntityRepository extends JpaRepository<ScriptEntity, String> {
}
