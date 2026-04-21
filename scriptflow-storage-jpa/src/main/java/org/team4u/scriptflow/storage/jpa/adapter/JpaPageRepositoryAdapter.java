package org.team4u.scriptflow.storage.jpa.adapter;

import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageBinding;
import org.team4u.scriptflow.domain.model.PageComponent;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.PageLayout;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.PageRepository;
import org.team4u.scriptflow.storage.jpa.entity.PageEntity;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataPageEntityRepository;

import java.util.List;
import java.util.Optional;

public class JpaPageRepositoryAdapter implements PageRepository {
    private final SpringDataPageEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaPageRepositoryAdapter(SpringDataPageEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public PageDefinition save(PageDefinition definition) {
        return toDomain(repository.save(toEntity(definition)));
    }

    @Override
    public Optional<PageDefinition> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<PageDefinition> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private PageEntity toEntity(PageDefinition definition) {
        PageEntity entity = new PageEntity();
        entity.setId(definition.getId());
        entity.setName(definition.getName());
        entity.setRenderer(definition.getRenderer());
        entity.setLayoutJson(jsonCodec.write(definition.getLayout()));
        entity.setComponentsJson(jsonCodec.write(definition.getComponents()));
        entity.setActionsJson(jsonCodec.write(definition.getActions()));
        entity.setBindingJson(jsonCodec.write(definition.getBinding()));
        entity.setCreatedAt(definition.getCreatedAt());
        entity.setUpdatedAt(definition.getUpdatedAt());
        return entity;
    }

    private PageDefinition toDomain(PageEntity entity) {
        return new PageDefinition()
                .setId(entity.getId())
                .setName(entity.getName())
                .setRenderer(entity.getRenderer())
                .setLayout(defaultIfNull(jsonCodec.read(entity.getLayoutJson(), PageLayout.class), new PageLayout()))
                .setComponents(jsonCodec.readList(entity.getComponentsJson(), PageComponent.class))
                .setActions(jsonCodec.readList(entity.getActionsJson(), PageActionDefinition.class))
                .setBinding(defaultIfNull(jsonCodec.read(entity.getBindingJson(), PageBinding.class), new PageBinding()))
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }

    private <T> T defaultIfNull(T value, T fallback) {
        return value == null ? fallback : value;
    }
}
