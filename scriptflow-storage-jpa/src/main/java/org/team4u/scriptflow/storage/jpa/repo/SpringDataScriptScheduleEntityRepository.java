package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import org.team4u.scriptflow.storage.jpa.entity.ScriptScheduleEntity;

import java.util.List;

public interface SpringDataScriptScheduleEntityRepository extends JpaRepository<ScriptScheduleEntity, String> {
    List<ScriptScheduleEntity> findAllByOrderByCreatedAtDesc();

    List<ScriptScheduleEntity> findByScriptIdOrderByCreatedAtDesc(String scriptId);

    List<ScriptScheduleEntity> findByEnabledTrueOrderByCreatedAtAsc();

    @Modifying
    @Transactional
    @Query("delete from ScriptScheduleEntity s where s.scriptId = :scriptId")
    int deleteAllByScriptId(@Param("scriptId") String scriptId);
}
