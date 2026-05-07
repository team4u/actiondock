package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.RepositoryEventSourceInstallation;
import org.team4u.actiondock.domain.port.RepositoryEventSourceInstallationRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryEventSourceInstallationEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryEventSourceInstallationRepository;

import java.util.Optional;

@Component
public class JpaRepositoryEventSourceInstallationRepositoryAdapter implements RepositoryEventSourceInstallationRepository {
    private final SpringDataRepositoryEventSourceInstallationRepository repository;

    public JpaRepositoryEventSourceInstallationRepositoryAdapter(SpringDataRepositoryEventSourceInstallationRepository repository) {
        this.repository = repository;
    }

    @Override
    public RepositoryEventSourceInstallation save(RepositoryEventSourceInstallation installation) {
        return toDomain(repository.save(toEntity(installation)));
    }

    @Override
    public Optional<RepositoryEventSourceInstallation> findBySourceId(String sourceId) {
        return repository.findById(sourceId).map(JpaRepositoryEventSourceInstallationRepositoryAdapter::toDomain);
    }

    @Override
    public void deleteBySourceId(String sourceId) {
        repository.deleteById(sourceId);
    }

    private static RepositoryEventSourceInstallationEntity toEntity(RepositoryEventSourceInstallation installation) {
        RepositoryEventSourceInstallationEntity entity = new RepositoryEventSourceInstallationEntity();
        entity.setSourceId(installation.getSourceId());
        entity.setRepositoryId(installation.getRepositoryId());
        entity.setEventSourceId(installation.getEventSourceId());
        entity.setName(installation.getName());
        entity.setVersionValue(installation.getVersion());
        entity.setLatestVersion(installation.getLatestVersion());
        entity.setOwner(installation.getOwner());
        entity.setDescription(installation.getDescription());
        entity.setInstalledAt(installation.getInstalledAt());
        entity.setUpdatedAt(installation.getUpdatedAt());
        return entity;
    }

    private static RepositoryEventSourceInstallation toDomain(RepositoryEventSourceInstallationEntity entity) {
        return new RepositoryEventSourceInstallation()
                .setSourceId(entity.getSourceId())
                .setRepositoryId(entity.getRepositoryId())
                .setEventSourceId(entity.getEventSourceId())
                .setName(entity.getName())
                .setVersion(entity.getVersionValue())
                .setLatestVersion(entity.getLatestVersion())
                .setOwner(entity.getOwner())
                .setDescription(entity.getDescription())
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
