package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.SkillTargetRepository;
import org.team4u.actiondock.storage.jpa.entity.SkillTargetEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataSkillTargetRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaSkillTargetRepositoryAdapter implements SkillTargetRepository {
    private final SpringDataSkillTargetRepository repository;

    public JpaSkillTargetRepositoryAdapter(SpringDataSkillTargetRepository repository) {
        this.repository = repository;
    }

    @Override
    public SkillTarget save(SkillTarget target) {
        return toDomain(repository.save(toEntity(target)));
    }

    @Override
    public Optional<SkillTarget> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<SkillTarget> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private SkillTargetEntity toEntity(SkillTarget target) {
        SkillTargetEntity entity = new SkillTargetEntity();
        entity.setId(target.getId());
        entity.setName(target.getName());
        entity.setType(target.getType());
        entity.setRootPath(target.getRootPath());
        entity.setEnabled(target.isEnabled());
        entity.setWritable(target.isWritable());
        entity.setCreatedAt(target.getCreatedAt());
        entity.setUpdatedAt(target.getUpdatedAt());
        return entity;
    }

    private SkillTarget toDomain(SkillTargetEntity entity) {
        return new SkillTarget()
                .setId(entity.getId())
                .setName(entity.getName())
                .setType(entity.getType())
                .setRootPath(entity.getRootPath())
                .setEnabled(entity.isEnabled())
                .setWritable(entity.isWritable())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
