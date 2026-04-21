package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.scriptflow.storage.jpa.entity.PageEntity;

public interface SpringDataPageEntityRepository extends JpaRepository<PageEntity, String> {
}
