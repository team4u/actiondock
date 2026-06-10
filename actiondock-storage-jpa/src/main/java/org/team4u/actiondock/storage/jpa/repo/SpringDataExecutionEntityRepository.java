package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import org.team4u.actiondock.storage.jpa.entity.ExecutionEntity;

import java.util.List;

/**
 * Spring Data JPA 执行记录实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataExecutionEntityRepository extends JpaRepository<ExecutionEntity, String> {
    List<ExecutionEntity> findByScriptIdOrderByCreatedAtDesc(String scriptId);

    List<ExecutionEntity> findByScheduleIdOrderByCreatedAtDesc(String scheduleId);

    @Modifying
    @Transactional
    @Query("delete from ExecutionEntity e where e.scriptId = :scriptId")
    int deleteAllByScriptId(@Param("scriptId") String scriptId);

    @Query("select e.id from ExecutionEntity e where e.scriptId = :scriptId order by e.createdAt desc")
    List<String> findIdsByScriptIdOrderByCreatedAtDesc(@Param("scriptId") String scriptId);

    @Modifying
    @Transactional
    @Query("delete from ExecutionEntity e where e.id in :ids")
    int deleteByIds(@Param("ids") List<String> ids);
}
