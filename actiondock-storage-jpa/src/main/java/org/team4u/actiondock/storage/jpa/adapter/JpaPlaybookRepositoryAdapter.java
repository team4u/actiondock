package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookAgentSkillRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.storage.jpa.entity.PlaybookEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaPlaybookRepositoryAdapter implements PlaybookRepository {
    private final SpringDataPlaybookRepository repository;
    private final JsonCodec jsonCodec;

    public JpaPlaybookRepositoryAdapter(SpringDataPlaybookRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public Playbook save(Playbook playbook) {
        return toDomain(repository.save(toEntity(playbook)));
    }

    @Override
    public Optional<Playbook> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<Playbook> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private PlaybookEntity toEntity(Playbook playbook) {
        PlaybookEntity entity = new PlaybookEntity();
        entity.setId(playbook.getId());
        entity.setName(playbook.getName());
        entity.setDescription(playbook.getDescription());
        entity.setTagsJson(jsonCodec.write(playbook.getTags()));
        entity.setRiskLevel(playbook.getRiskLevel() == null ? null : playbook.getRiskLevel().name());
        entity.setRepositoryIdsJson(jsonCodec.write(playbook.getRepositoryIds()));
        entity.setKnowledgeRefsJson(jsonCodec.write(playbook.getKnowledgeRefs()));
        entity.setScriptRefsJson(jsonCodec.write(playbook.getScriptRefs()));
        entity.setAgentSkillRefsJson(jsonCodec.write(playbook.getAgentSkillRefs()));
        entity.setRelatedPlaybookRefsJson(jsonCodec.write(playbook.getRelatedPlaybookRefs()));
        entity.setGuideMarkdown(playbook.getGuideMarkdown());
        entity.setStopConditionsJson(jsonCodec.write(playbook.getStopConditions()));
        entity.setEnabled(playbook.isEnabled());
        entity.setManaged(playbook.isManaged());
        entity.setCreatedAt(playbook.getCreatedAt());
        entity.setUpdatedAt(playbook.getUpdatedAt());
        return entity;
    }

    private Playbook toDomain(PlaybookEntity entity) {
        return new Playbook()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setTags(jsonCodec.readList(entity.getTagsJson(), String.class))
                .setRiskLevel(entity.getRiskLevel() == null || entity.getRiskLevel().isBlank()
                        ? null
                        : PlaybookRiskLevel.valueOf(entity.getRiskLevel()))
                .setRepositoryIds(jsonCodec.readList(entity.getRepositoryIdsJson(), String.class))
                .setKnowledgeRefs(jsonCodec.readList(entity.getKnowledgeRefsJson(), PlaybookKnowledgeRef.class))
                .setScriptRefs(jsonCodec.readList(entity.getScriptRefsJson(), PlaybookScriptRef.class))
                .setAgentSkillRefs(jsonCodec.readList(entity.getAgentSkillRefsJson(), PlaybookAgentSkillRef.class))
                .setRelatedPlaybookRefs(jsonCodec.readList(entity.getRelatedPlaybookRefsJson(), PlaybookRelatedRef.class))
                .setGuideMarkdown(entity.getGuideMarkdown())
                .setStopConditions(jsonCodec.readList(entity.getStopConditionsJson(), String.class))
                .setEnabled(entity.isEnabled())
                .setManaged(entity.isManaged())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
