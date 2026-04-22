package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.scriptflow.storage.jpa.entity.PluginRegistrationEntity;

import java.util.List;

public interface SpringDataPluginRegistrationRepository extends JpaRepository<PluginRegistrationEntity, String> {
    List<PluginRegistrationEntity> findByEnabledTrueOrderByPluginIdAsc();
}
