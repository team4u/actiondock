package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;

import java.time.LocalDateTime;
import java.util.List;

public class AiModelProfileService {
    private final AiModelProfileRepository repository;

    public AiModelProfileService(AiModelProfileRepository repository) {
        this.repository = repository;
    }

    public List<AiModelProfile> list() {
        return repository.findAll();
    }

    public AiModelProfile get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("AI 模型 Profile 不存在: " + id));
    }

    public AiModelProfile save(AiModelProfile profile) {
        validate(profile);
        LocalDateTime now = LocalDateTime.now();
        AiModelProfile existing = repository.findById(profile.getId()).orElse(null);
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

    private void validate(AiModelProfile profile) {
        if (profile == null) {
            throw new IllegalArgumentException("AI 模型 Profile 不能为空");
        }
        if (profile.getId() == null || profile.getId().isBlank()) {
            throw new IllegalArgumentException("AI 模型 Profile ID 不能为空");
        }
        if (profile.getName() == null || profile.getName().isBlank()) {
            throw new IllegalArgumentException("AI 模型 Profile 名称不能为空");
        }
        if (profile.getModelProvider() == null) {
            throw new IllegalArgumentException("模型供应商不能为空");
        }
        if (profile.getModelName() == null || profile.getModelName().isBlank()) {
            throw new IllegalArgumentException("模型名称不能为空");
        }
    }
}
