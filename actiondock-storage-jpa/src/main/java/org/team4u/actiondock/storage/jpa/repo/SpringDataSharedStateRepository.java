package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import org.team4u.actiondock.storage.jpa.entity.SharedStateEntity;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Spring Data JPA 共享状态实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataSharedStateRepository extends JpaRepository<SharedStateEntity, String> {
    Optional<SharedStateEntity> findByNamespaceAndEntryKey(String namespace, String entryKey);

    List<SharedStateEntity> findByNamespaceOrderByEntryKeyAsc(String namespace);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query("""
            update SharedStateEntity e
               set e.valueJson = :valueJson,
                   e.secret = :secret,
                   e.versionValue = :nextVersion,
                   e.expiresAt = :expiresAt,
                   e.updatedAt = :updatedAt,
                   e.lastWriterScriptId = :lastWriterScriptId,
                   e.lastWriterExecutionId = :lastWriterExecutionId
             where e.namespace = :namespace
               and e.entryKey = :entryKey
               and e.versionValue = :expectedVersion
            """)
    int compareAndSet(@Param("namespace") String namespace,
                      @Param("entryKey") String entryKey,
                      @Param("expectedVersion") Long expectedVersion,
                      @Param("nextVersion") Long nextVersion,
                      @Param("valueJson") String valueJson,
                      @Param("secret") boolean secret,
                      @Param("expiresAt") LocalDateTime expiresAt,
                      @Param("updatedAt") LocalDateTime updatedAt,
                      @Param("lastWriterScriptId") String lastWriterScriptId,
                      @Param("lastWriterExecutionId") String lastWriterExecutionId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query("delete from SharedStateEntity e where e.expiresAt is not null and e.expiresAt <= :now")
    int deleteExpired(@Param("now") LocalDateTime now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query("""
            delete from SharedStateEntity e
             where e.namespace = :namespace
               and e.expiresAt is not null
               and e.expiresAt <= :now
            """)
    int deleteExpiredByNamespace(@Param("namespace") String namespace, @Param("now") LocalDateTime now);
}
