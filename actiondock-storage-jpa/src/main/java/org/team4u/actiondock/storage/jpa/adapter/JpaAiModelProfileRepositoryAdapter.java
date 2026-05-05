package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiProvider;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.AiModelProfileEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiModelProfileRepository;

import java.util.LinkedHashSet;
import java.util.Set;

@Component
public class JpaAiModelProfileRepositoryAdapter
        extends AbstractJpaRepositoryAdapter<AiModelProfileEntity, AiModelProfile, SpringDataAiModelProfileRepository>
        implements AiModelProfileRepository {

    private final JsonCodec jsonCodec;

    public JpaAiModelProfileRepositoryAdapter(SpringDataAiModelProfileRepository repository, JsonCodec jsonCodec) {
        super(repository);
        this.jsonCodec = jsonCodec;
    }

    @Override
    protected AiModelProfileEntity toEntity(AiModelProfile profile) {
        AiModelProfileEntity entity = new AiModelProfileEntity();
        entity.setId(profile.getId());
        entity.setName(profile.getName());
        entity.setProvider(profile.getProvider().name());
        entity.setModelProvider(profile.getModelProvider().name());
        entity.setModelName(profile.getModelName());
        entity.setBaseUrl(profile.getBaseUrl());
        entity.setApiKeyConfigKey(profile.getApiKeyConfigKey());
        entity.setDefaultOptionsJson(jsonCodec.write(profile.getDefaultOptions()));
        entity.setLimitsJson(jsonCodec.write(profile.getLimits()));
        entity.setCapabilitiesJson(jsonCodec.write(profile.getCapabilities().stream().map(Enum::name).toList()));
        entity.setEnabled(profile.isEnabled());
        entity.setCreatedAt(profile.getCreatedAt());
        entity.setUpdatedAt(profile.getUpdatedAt());
        return entity;
    }

    @Override
    protected AiModelProfile toDomain(AiModelProfileEntity entity) {
        Set<AiCapability> capabilities = new LinkedHashSet<>();
        jsonCodec.readList(entity.getCapabilitiesJson(), String.class).forEach(value -> capabilities.add(AiCapability.valueOf(value)));
        return new AiModelProfile()
                .setId(entity.getId())
                .setName(entity.getName())
                .setProvider(entity.getProvider() == null ? AiProvider.AGENTSCOPE : AiProvider.valueOf(entity.getProvider()))
                .setModelProvider(entity.getModelProvider() == null ? null : AiModelProvider.valueOf(entity.getModelProvider()))
                .setModelName(entity.getModelName())
                .setBaseUrl(entity.getBaseUrl())
                .setApiKeyConfigKey(entity.getApiKeyConfigKey())
                .setDefaultOptions(jsonCodec.readMap(entity.getDefaultOptionsJson()))
                .setLimits(jsonCodec.readMap(entity.getLimitsJson()))
                .setCapabilities(capabilities)
                .setEnabled(entity.isEnabled())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
