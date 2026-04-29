package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.RepositoryAiPackageInstallation;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.RepositoryAiPackageInstallationRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryAiPackageInstallationEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryAiPackageInstallationRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaRepositoryAiPackageInstallationRepositoryAdapter implements RepositoryAiPackageInstallationRepository {
    private final SpringDataRepositoryAiPackageInstallationRepository repository;
    private final JsonCodec jsonCodec;

    public JpaRepositoryAiPackageInstallationRepositoryAdapter(SpringDataRepositoryAiPackageInstallationRepository repository,
                                                              JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public RepositoryAiPackageInstallation save(RepositoryAiPackageInstallation installation) {
        return toDomain(repository.save(toEntity(installation)));
    }

    @Override
    public Optional<RepositoryAiPackageInstallation> findByInstallationId(String installationId) {
        return repository.findById(installationId).map(this::toDomain);
    }

    @Override
    public Optional<RepositoryAiPackageInstallation> findByEntryAgentId(String entryAgentId) {
        return repository.findByEntryAgentId(entryAgentId).map(this::toDomain);
    }

    @Override
    public List<RepositoryAiPackageInstallation> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteByInstallationId(String installationId) {
        repository.deleteById(installationId);
    }

    private RepositoryAiPackageInstallationEntity toEntity(RepositoryAiPackageInstallation installation) {
        RepositoryAiPackageInstallationEntity entity = new RepositoryAiPackageInstallationEntity();
        entity.setInstallationId(installation.getInstallationId());
        entity.setRepositoryId(installation.getRepositoryId());
        entity.setPackageId(installation.getPackageId());
        entity.setName(installation.getName());
        entity.setVersionValue(installation.getVersion());
        entity.setLatestVersion(installation.getLatestVersion());
        entity.setEntryAgentId(installation.getEntryAgentId());
        entity.setOwner(installation.getOwner());
        entity.setDescription(installation.getDescription());
        entity.setModelIdsJson(jsonCodec.write(installation.getModelIds()));
        entity.setToolsetIdsJson(jsonCodec.write(installation.getToolsetIds()));
        entity.setAgentIdsJson(jsonCodec.write(installation.getAgentIds()));
        entity.setScriptIdsJson(jsonCodec.write(installation.getScriptIds()));
        entity.setInstalledAt(installation.getInstalledAt());
        entity.setUpdatedAt(installation.getUpdatedAt());
        return entity;
    }

    private RepositoryAiPackageInstallation toDomain(RepositoryAiPackageInstallationEntity entity) {
        return new RepositoryAiPackageInstallation()
                .setInstallationId(entity.getInstallationId())
                .setRepositoryId(entity.getRepositoryId())
                .setPackageId(entity.getPackageId())
                .setName(entity.getName())
                .setVersion(entity.getVersionValue())
                .setLatestVersion(entity.getLatestVersion())
                .setEntryAgentId(entity.getEntryAgentId())
                .setOwner(entity.getOwner())
                .setDescription(entity.getDescription())
                .setModelIds(jsonCodec.readList(entity.getModelIdsJson(), String.class))
                .setToolsetIds(jsonCodec.readList(entity.getToolsetIdsJson(), String.class))
                .setAgentIds(jsonCodec.readList(entity.getAgentIdsJson(), String.class))
                .setScriptIds(jsonCodec.readList(entity.getScriptIdsJson(), String.class))
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
