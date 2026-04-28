package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiProvider;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiAgentProfileEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentProfileRepository;

import java.util.List;
import java.util.Optional;

public class JpaAiAgentProfileRepositoryAdapter implements AiAgentProfileRepository {
    private final SpringDataAiAgentProfileRepository repository;
    private final JsonCodec jsonCodec;

    public JpaAiAgentProfileRepositoryAdapter(SpringDataAiAgentProfileRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public AiAgentProfile save(AiAgentProfile profile) {
        return toDomain(repository.save(toEntity(profile)));
    }

    @Override
    public Optional<AiAgentProfile> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<AiAgentProfile> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private AiAgentProfileEntity toEntity(AiAgentProfile profile) {
        AiAgentProfileEntity entity = new AiAgentProfileEntity();
        entity.setId(profile.getId());
        entity.setName(profile.getName());
        entity.setDescription(profile.getDescription());
        entity.setProvider(profile.getProvider().name());
        entity.setModelProfileId(profile.getModelProfileId());
        entity.setSystemPrompt(profile.getSystemPrompt());
        entity.setToolsetIdsJson(jsonCodec.write(profile.getToolsetIds()));
        entity.setOptionsJson(jsonCodec.write(profile.getOptions()));
        entity.setPolicyJson(jsonCodec.write(profile.getPolicy()));
        entity.setEnabled(profile.isEnabled());
        entity.setCreatedAt(profile.getCreatedAt());
        entity.setUpdatedAt(profile.getUpdatedAt());
        return entity;
    }

    private AiAgentProfile toDomain(AiAgentProfileEntity entity) {
        return new AiAgentProfile()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setProvider(entity.getProvider() == null ? AiProvider.AGENTSCOPE : AiProvider.valueOf(entity.getProvider()))
                .setModelProfileId(entity.getModelProfileId())
                .setSystemPrompt(entity.getSystemPrompt())
                .setToolsetIds(jsonCodec.readList(entity.getToolsetIdsJson(), String.class))
                .setOptions(jsonCodec.readMap(entity.getOptionsJson()))
                .setPolicy(jsonCodec.readMap(entity.getPolicyJson()))
                .setEnabled(entity.isEnabled())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
