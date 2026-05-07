package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.RepositoryEventSourceInstallation;

import java.util.Optional;

public interface RepositoryEventSourceInstallationRepository {
    RepositoryEventSourceInstallation save(RepositoryEventSourceInstallation installation);

    Optional<RepositoryEventSourceInstallation> findBySourceId(String sourceId);

    void deleteBySourceId(String sourceId);
}
