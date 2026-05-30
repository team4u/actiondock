package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.PlaybookGroup;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PlaybookGroupRepository;
import org.team4u.actiondock.storage.jpa.entity.PlaybookGroupEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookGroupRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaPlaybookGroupRepositoryAdapter implements PlaybookGroupRepository {
    private final SpringDataPlaybookGroupRepository repository;
    private final JsonCodec jsonCodec;

    public JpaPlaybookGroupRepositoryAdapter(SpringDataPlaybookGroupRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public PlaybookGroup save(PlaybookGroup group) {
        return toDomain(repository.save(toEntity(group)));
    }

    @Override
    public Optional<PlaybookGroup> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<PlaybookGroup> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private PlaybookGroupEntity toEntity(PlaybookGroup group) {
        PlaybookGroupEntity entity = new PlaybookGroupEntity();
        entity.setId(group.getId());
        entity.setName(group.getName());
        entity.setDescription(group.getDescription());
        entity.setTagsJson(jsonCodec.write(group.getTags()));
        entity.setDefaultRepositoryIdsJson(jsonCodec.write(group.getDefaultRepositoryIds()));
        entity.setEnabled(group.isEnabled());
        entity.setManaged(group.isManaged());
        entity.setCreatedAt(group.getCreatedAt());
        entity.setUpdatedAt(group.getUpdatedAt());
        return entity;
    }

    private PlaybookGroup toDomain(PlaybookGroupEntity entity) {
        return new PlaybookGroup()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setTags(jsonCodec.readList(entity.getTagsJson(), String.class))
                .setDefaultRepositoryIds(jsonCodec.readList(entity.getDefaultRepositoryIdsJson(), String.class))
                .setEnabled(entity.isEnabled())
                .setManaged(entity.isManaged())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
