package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.EventRecordEntity;

import java.util.List;

public interface SpringDataEventRecordEntityRepository extends JpaRepository<EventRecordEntity, String> {
    List<EventRecordEntity> findAllByOrderByCreatedAtDesc();

    List<EventRecordEntity> findBySourceIdOrderByCreatedAtDesc(String sourceId);
}
