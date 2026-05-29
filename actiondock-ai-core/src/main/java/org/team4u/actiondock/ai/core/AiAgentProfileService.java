package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentSkillRegistry;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import org.team4u.actiondock.domain.model.ScriptPackaging;



/**
 * AI Agent 配置档案服务，管理 Agent Profile 的增删改查。
 * <p>
 * 提供 Agent 配置的校验（ID、名称、模型 Profile、工具集和 Skill 引用有效性检查）、
 * 托管资源可变性检查，以及通过 {@link AiToolRegistryImpl} 进行的工具冲突预检。
 * 保存时自动填充创建时间和更新时间。
 *
 * @author jay.wu
 */
public class AiAgentProfileService {

    private final AiAgentProfileRepository repository;
    private final AiModelProfileRepository modelProfileRepository;
    private final AiToolsetRepository toolsetRepository;
    private final AiToolRegistryImpl toolRegistry;
    private final AiAgentSkillRegistry skillRegistry;

    public AiAgentProfileService(AiAgentProfileRepository repository, AiModelProfileRepository modelProfileRepository) {
        this(repository, modelProfileRepository, null, null);
    }

    public AiAgentProfileService(AiAgentProfileRepository repository,
                                 AiModelProfileRepository modelProfileRepository,
                                 AiToolsetRepository toolsetRepository) {
        this(repository, modelProfileRepository, toolsetRepository, null);
    }

    public AiAgentProfileService(AiAgentProfileRepository repository,
                                 AiModelProfileRepository modelProfileRepository,
                                 AiToolsetRepository toolsetRepository,
                                 AiToolRegistryImpl toolRegistry) {
        this(repository, modelProfileRepository, toolsetRepository, toolRegistry, null);
    }

    public AiAgentProfileService(AiAgentProfileRepository repository,
                                 AiModelProfileRepository modelProfileRepository,
                                 AiToolsetRepository toolsetRepository,
                                 AiToolRegistryImpl toolRegistry,
                                 AiAgentSkillRegistry skillRegistry) {
        this.repository = repository;
        this.modelProfileRepository = modelProfileRepository;
        this.toolsetRepository = toolsetRepository;
        this.toolRegistry = toolRegistry;
        this.skillRegistry = skillRegistry;
    }

    public List<AiAgentProfile> list() {
        return repository.findAll();
    }

    public List<AiAgentProfile> list(boolean includeManaged) {
        return list().stream()
                .filter(profile -> includeManaged || !ScriptPackaging.isManagedId(profile.getId()))
                .toList();
    }

    public AiAgentProfile get(String id) {
        return repository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.AI_AGENT_PROFILE_NOT_FOUND,
                        "AI Agent Profile 不存在: " + id,
                        Map.of("profileId", id)
                ));
    }

    public AiAgentProfile save(AiAgentProfile profile) {
        validate(profile);
        assertMutable(profile.getId());
        return AiTimestampSupport.saveWithTimestamps(profile, profile.getId(),
                repository::findById, AiAgentProfile::getCreatedAt,
                AiAgentProfile::setCreatedAt, AiAgentProfile::setUpdatedAt, repository::save);
    }

    public void delete(String id) {
        assertMutable(id);
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
            throw ActionDockException.notFound(
                    ActionDockErrorCodes.AI_MODEL_PROFILE_NOT_FOUND,
                    "模型 Profile 不存在: " + profile.getModelProfileId(),
                    Map.of("profileId", profile.getModelProfileId())
            );
        }
        if (toolRegistry != null) {
            toolRegistry.listAgentTools(profile);
        } else if (toolsetRepository != null) {
            for (String toolsetId : profile.getToolsetIds()) {
                if (toolsetId == null || toolsetId.isBlank()) {
                    throw new IllegalArgumentException("工具集 ID 不能为空");
                }
                if (toolsetRepository.findById(toolsetId).isEmpty()) {
                    throw ActionDockException.notFound(
                            ActionDockErrorCodes.AI_TOOLSET_NOT_FOUND,
                            "AI 工具集不存在: " + toolsetId,
                            Map.of("toolsetId", toolsetId)
                    );
                }
            }
        }
        for (String skillId : new LinkedHashSet<>(profile.getSkillIds())) {
            if (skillId == null || skillId.isBlank()) {
                throw new IllegalArgumentException("Agent Skill ID 不能为空");
            }
            if (skillRegistry != null) {
                skillRegistry.requireSkill(skillId);
            }
        }
    }

    private static void assertMutable(String id) {
        ScriptPackaging.assertMutable(id, "Agent");
    }
}
