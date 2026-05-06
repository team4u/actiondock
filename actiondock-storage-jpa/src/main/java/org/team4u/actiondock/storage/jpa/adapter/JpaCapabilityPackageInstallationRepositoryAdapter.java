package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.CapabilityPackageInstallationEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataCapabilityPackageInstallationRepository;

import java.util.Optional;

@Component
public class JpaCapabilityPackageInstallationRepositoryAdapter implements CapabilityPackageInstallationRepository {
    private final SpringDataCapabilityPackageInstallationRepository repository;
    private final JsonCodec jsonCodec;

    public JpaCapabilityPackageInstallationRepositoryAdapter(SpringDataCapabilityPackageInstallationRepository repository,
                                                             JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public CapabilityPackageInstallation save(CapabilityPackageInstallation installation) {
        return toDomain(repository.save(toEntity(installation)));
    }

    @Override
    public Optional<CapabilityPackageInstallation> findByInstallationId(String installationId) {
        return repository.findById(installationId).map(this::toDomain);
    }

    @Override
    public Optional<CapabilityPackageInstallation> findByEntryAgentId(String entryAgentId) {
        return repository.findByEntryAgentId(entryAgentId).map(this::toDomain);
    }

    @Override
    public void deleteByInstallationId(String installationId) {
        repository.deleteById(installationId);
    }

    private CapabilityPackageInstallationEntity toEntity(CapabilityPackageInstallation installation) {
        CapabilityPackageInstallationEntity entity = new CapabilityPackageInstallationEntity();
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
        entity.setScheduleIdsJson(jsonCodec.write(installation.getScheduleIds()));
        entity.setPresetIdsJson(jsonCodec.write(installation.getPresetIds()));
        entity.setInstalledAt(installation.getInstalledAt());
        entity.setUpdatedAt(installation.getUpdatedAt());
        return entity;
    }

    private CapabilityPackageInstallation toDomain(CapabilityPackageInstallationEntity entity) {
        return new CapabilityPackageInstallation()
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
                .setScheduleIds(jsonCodec.readList(entity.getScheduleIdsJson(), String.class))
                .setPresetIds(jsonCodec.readList(entity.getPresetIdsJson(), String.class))
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
