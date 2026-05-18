package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.storage.jpa.entity.ManagedSkillEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataManagedSkillRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaManagedSkillRepositoryAdapter implements ManagedSkillRepository {
    private final SpringDataManagedSkillRepository repository;

    public JpaManagedSkillRepositoryAdapter(SpringDataManagedSkillRepository repository) {
        this.repository = repository;
    }

    @Override
    public ManagedSkill save(ManagedSkill skill) {
        return toDomain(repository.save(toEntity(skill)));
    }

    @Override
    public Optional<ManagedSkill> findBySkillId(String skillId) {
        return repository.findById(skillId).map(JpaManagedSkillRepositoryAdapter::toDomain);
    }

    @Override
    public List<ManagedSkill> findAll() {
        return repository.findAll().stream().map(JpaManagedSkillRepositoryAdapter::toDomain).toList();
    }

    @Override
    public void deleteBySkillId(String skillId) {
        repository.deleteById(skillId);
    }

    private static ManagedSkillEntity toEntity(ManagedSkill skill) {
        ManagedSkillEntity entity = new ManagedSkillEntity();
        entity.setSkillId(skill.getSkillId());
        entity.setRepositoryId(skill.getRepositoryId());
        entity.setVersionValue(skill.getVersion());
        entity.setDigest(skill.getDigest());
        entity.setDisplayName(skill.getDisplayName());
        entity.setDescription(skill.getDescription());
        entity.setInstalledAt(skill.getInstalledAt());
        entity.setUpdatedAt(skill.getUpdatedAt());
        return entity;
    }

    private static ManagedSkill toDomain(ManagedSkillEntity entity) {
        return new ManagedSkill()
                .setSkillId(entity.getSkillId())
                .setRepositoryId(entity.getRepositoryId())
                .setVersion(entity.getVersionValue())
                .setDigest(entity.getDigest())
                .setDisplayName(entity.getDisplayName())
                .setDescription(entity.getDescription())
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
