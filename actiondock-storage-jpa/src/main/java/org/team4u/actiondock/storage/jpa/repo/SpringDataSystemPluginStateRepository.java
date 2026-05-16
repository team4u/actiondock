package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.SystemPluginStateEntity;

public interface SpringDataSystemPluginStateRepository extends JpaRepository<SystemPluginStateEntity, String> {
}
