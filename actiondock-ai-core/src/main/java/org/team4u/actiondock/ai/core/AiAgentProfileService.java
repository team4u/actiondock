package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;

import java.time.LocalDateTime;
import java.util.List;

public class AiAgentProfileService {
    private final AiAgentProfileRepository repository;
    private final AiModelProfileRepository modelProfileRepository;
    private final AiToolsetRepository toolsetRepository;

    public AiAgentProfileService(AiAgentProfileRepository repository, AiModelProfileRepository modelProfileRepository) {
        this(repository, modelProfileRepository, null);
    }

    public AiAgentProfileService(AiAgentProfileRepository repository,
                                 AiModelProfileRepository modelProfileRepository,
                                 AiToolsetRepository toolsetRepository) {
        this.repository = repository;
        this.modelProfileRepository = modelProfileRepository;
        this.toolsetRepository = toolsetRepository;
    }

    public List<AiAgentProfile> list() {
        return repository.findAll();
    }

    public AiAgentProfile get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("AI Agent Profile 不存在: " + id));
    }

    public AiAgentProfile save(AiAgentProfile profile) {
        validate(profile);
        LocalDateTime now = LocalDateTime.now();
        AiAgentProfile existing = repository.findById(profile.getId()).orElse(null);
        if (existing == null) {
            profile.setCreatedAt(now);
        } else if (profile.getCreatedAt() == null) {
            profile.setCreatedAt(existing.getCreatedAt());
        }
        profile.setUpdatedAt(now);
        return repository.save(profile);
    }

    public void delete(String id) {
        repository.deleteById(id);
    }

    private void validate(AiAgentProfile profile) {
        if (profile == null) {
            throw new IllegalArgumentException("AI Agent Profile 不能为空");
        }
        if (profile.getId() == null || profile.getId().isBlank()) {
            throw new IllegalArgumentException("AI Agent Profile ID 不能为空");
        }
        if (profile.getName() == null || profile.getName().isBlank()) {
            throw new IllegalArgumentException("AI Agent Profile 名称不能为空");
        }
        if (profile.getModelProfileId() == null || profile.getModelProfileId().isBlank()) {
            throw new IllegalArgumentException("模型 Profile 不能为空");
        }
        if (modelProfileRepository.findById(profile.getModelProfileId()).isEmpty()) {
            throw new IllegalArgumentException("模型 Profile 不存在: " + profile.getModelProfileId());
        }
        if (toolsetRepository != null) {
            for (String toolsetId : profile.getToolsetIds()) {
                if (toolsetId == null || toolsetId.isBlank()) {
                    throw new IllegalArgumentException("工具集 ID 不能为空");
                }
                if (toolsetRepository.findById(toolsetId).isEmpty()) {
                    throw new IllegalArgumentException("AI 工具集不存在: " + toolsetId);
                }
            }
        }
    }
}
