package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.SkillTargetRepository;
import org.team4u.actiondock.storage.jpa.entity.SkillTargetEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataSkillTargetRepository;

@Component
public class JpaSkillTargetRepositoryAdapter
        extends AbstractJpaRepositoryAdapter<SkillTargetEntity, SkillTarget, SpringDataSkillTargetRepository>
        implements SkillTargetRepository {

    public JpaSkillTargetRepositoryAdapter(SpringDataSkillTargetRepository repository) {
        super(repository);
    }

    @Override
    protected SkillTargetEntity toEntity(SkillTarget target) {
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

    @Override
    protected SkillTarget toDomain(SkillTargetEntity entity) {
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
