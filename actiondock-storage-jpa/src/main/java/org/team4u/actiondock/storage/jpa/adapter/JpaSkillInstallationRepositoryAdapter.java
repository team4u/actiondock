package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.storage.jpa.entity.SkillInstallationEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataSkillInstallationRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaSkillInstallationRepositoryAdapter implements SkillInstallationRepository {
    private final SpringDataSkillInstallationRepository repository;

    public JpaSkillInstallationRepositoryAdapter(SpringDataSkillInstallationRepository repository) {
        this.repository = repository;
    }

    @Override
    public SkillInstallation save(SkillInstallation installation) {
        return toDomain(repository.save(toEntity(installation)));
    }

    @Override
    public Optional<SkillInstallation> findBySkillIdAndTargetId(String skillId, String targetId) {
        return repository.findBySkillIdAndTargetId(skillId, targetId).map(JpaSkillInstallationRepositoryAdapter::toDomain);
    }

    @Override
    public List<SkillInstallation> findAll() {
        return repository.findAll().stream().map(JpaSkillInstallationRepositoryAdapter::toDomain).toList();
    }

    @Override
    public List<SkillInstallation> findBySkillId(String skillId) {
        return repository.findBySkillIdOrderByInstallationIdAsc(skillId).stream().map(JpaSkillInstallationRepositoryAdapter::toDomain).toList();
    }

    @Override
    public List<SkillInstallation> findByTargetId(String targetId) {
        return repository.findByTargetIdOrderByInstallationIdAsc(targetId).stream().map(JpaSkillInstallationRepositoryAdapter::toDomain).toList();
    }

    @Override
    @Transactional
    public void deleteBySkillIdAndTargetId(String skillId, String targetId) {
        repository.deleteBySkillIdAndTargetId(skillId, targetId);
    }

    private static SkillInstallationEntity toEntity(SkillInstallation installation) {
        SkillInstallationEntity entity = new SkillInstallationEntity();
        entity.setInstallationId(installation.getInstallationId());
        entity.setSkillId(installation.getSkillId());
        entity.setRepositoryId(installation.getRepositoryId());
        entity.setVersionValue(installation.getVersion());
        entity.setTargetId(installation.getTargetId());
        entity.setTargetPath(installation.getTargetPath());
        entity.setInstalledPath(installation.getInstalledPath());
        entity.setDigest(installation.getDigest());
        entity.setDisplayName(installation.getDisplayName());
        entity.setDescription(installation.getDescription());
        entity.setEnabled(installation.isEnabled());
        entity.setInstalledAt(installation.getInstalledAt());
        entity.setUpdatedAt(installation.getUpdatedAt());
        return entity;
    }

    private static SkillInstallation toDomain(SkillInstallationEntity entity) {
        return new SkillInstallation()
                .setInstallationId(entity.getInstallationId())
                .setSkillId(entity.getSkillId())
                .setRepositoryId(entity.getRepositoryId())
                .setVersion(entity.getVersionValue())
                .setTargetId(entity.getTargetId())
                .setTargetPath(entity.getTargetPath())
                .setInstalledPath(entity.getInstalledPath())
                .setDigest(entity.getDigest())
                .setDisplayName(entity.getDisplayName())
                .setDescription(entity.getDescription())
                .setEnabled(entity.isEnabled())
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
