package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.PlaybookSessionEntity;

import java.util.List;

public interface SpringDataPlaybookSessionRepository extends JpaRepository<PlaybookSessionEntity, String> {
    List<PlaybookSessionEntity> findAllByOrderByUpdatedAtDescStartedAtDesc();
}
