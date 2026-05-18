package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import org.team4u.actiondock.storage.jpa.entity.ExecutionPresetEntity;

import java.util.List;

/**
 * Spring Data JPA 执行参数预设实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataExecutionPresetEntityRepository extends JpaRepository<ExecutionPresetEntity, String> {

    List<ExecutionPresetEntity> findByScriptIdOrderByCreatedAtDesc(String scriptId);

    @Modifying
    @Transactional
    @Query("delete from ExecutionPresetEntity e where e.scriptId = :scriptId")
    int deleteAllByScriptId(@Param("scriptId") String scriptId);
}
