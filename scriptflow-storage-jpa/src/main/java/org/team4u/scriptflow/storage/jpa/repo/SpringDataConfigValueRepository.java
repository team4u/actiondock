package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.scriptflow.storage.jpa.entity.ConfigValueEntity;

import java.util.List;

public interface SpringDataConfigValueRepository extends JpaRepository<ConfigValueEntity, String> {
    List<ConfigValueEntity> findAllByOrderByKeyAsc();
}
