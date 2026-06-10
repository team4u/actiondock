package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import org.team4u.actiondock.domain.model.ScriptPackaging;


/**
 * AI 模型配置档案服务，管理模型 Profile 的增删改查。
 * <p>
 * 提供模型配置的校验（ID、名称、供应商、模型名称必填）、
 * 托管资源可变性检查（禁止修改/删除托管资源）以及级联引用检查（被 Agent 引用时禁止删除）。
 * 保存时自动填充创建时间和更新时间。
 *
 * @author jay.wu
 */
public class AiModelProfileService {

    private final AiModelProfileRepository repository;
    private final AiAgentProfileRepository agentProfileRepository;

    public AiModelProfileService(AiModelProfileRepository repository) {
        this(repository, null);
    }

    public AiModelProfileService(AiModelProfileRepository repository, AiAgentProfileRepository agentProfileRepository) {
        this.repository = repository;
        this.agentProfileRepository = agentProfileRepository;
    }

    public List<AiModelProfile> list() {
        return repository.findAll();
    }

    public List<AiModelProfile> list(boolean includeManaged) {
        return list().stream()
                .filter(profile -> includeManaged || !ScriptPackaging.isManagedId(profile.getId()))
                .toList();
    }

    public AiModelProfile get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.AI_MODEL_PROFILE_NOT_FOUND,
                        "AI 模型 Profile 不存在: " + id,
                        Map.of("profileId", id)
                ));
    }

    public AiModelProfile save(AiModelProfile profile) {
        validate(profile);
        assertMutable(profile.getId());
        return AiTimestampSupport.saveWithTimestamps(profile, profile.getId(),
                repository::findById, AiModelProfile::getCreatedAt,
                AiModelProfile::setCreatedAt, AiModelProfile::setUpdatedAt, repository::save);
    }

    public void delete(String id) {
        assertMutable(id);
        if (agentProfileRepository != null) {
            agentProfileRepository.findAll().stream()
                    .filter(agent -> id != null && id.equals(agent.getModelProfileId()))
                    .findFirst()
                    .ifPresent(agent -> {
                        throw new IllegalArgumentException("模型 Profile 已被 Agent 引用，不能删除: " + agent.getId());
                    });
        }
        repository.deleteById(id);
    }

    private static void validate(AiModelProfile profile) {
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

    private static void assertMutable(String id) {
        ScriptPackaging.assertMutable(id, "模型");
    }
}
