package org.team4u.actiondock.ai.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.domain.exception.ActionDockException;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AiModelProfileService 的单元测试。
 * <p>
 * 覆盖模型配置档案的查询、保存校验、托管资源保护、级联引用检查等核心逻辑。
 *
 * @author jay.wu
 */
class AiModelProfileServiceTest {

    private AiModelProfileRepository repository;
    private AiAgentProfileRepository agentProfileRepository;
    private AiModelProfileService service;

    @BeforeEach
    void setUp() {
        repository = Mockito.mock(AiModelProfileRepository.class);
        agentProfileRepository = Mockito.mock(AiAgentProfileRepository.class);
        service = new AiModelProfileService(repository, agentProfileRepository);
    }

    // ==================== list 测试 ====================

    /**
     * 查询所有模型配置时，应返回仓储中的全部记录。
     */
    @Test
    void shouldListAllProfiles() {
        List<AiModelProfile> profiles = List.of(buildProfile("p1"), buildProfile("p2"));
        when(repository.findAll()).thenReturn(profiles);

        List<AiModelProfile> result = service.list();

        assertThat(result).hasSize(2);
        verify(repository).findAll();
    }

    /**
     * 查询所有模型配置时，如果仓储为空，应返回空列表。
     */
    @Test
    void shouldReturnEmptyListWhenNoProfiles() {
        when(repository.findAll()).thenReturn(Collections.emptyList());

        List<AiModelProfile> result = service.list();

        assertThat(result).isEmpty();
    }

    // ==================== list(boolean) 测试 ====================

    /**
     * includeManaged 为 true 时，应返回所有记录（包括托管资源）。
     */
    @Test
    void shouldListAllProfilesWhenIncludeManagedIsTrue() {
        AiModelProfile managed = buildProfile("cap.managed-model");
        AiModelProfile custom = buildProfile("custom-model");
        when(repository.findAll()).thenReturn(List.of(managed, custom));

        List<AiModelProfile> result = service.list(true);

        assertThat(result).hasSize(2)
                .extracting(AiModelProfile::getId)
                .containsExactly("cap.managed-model", "custom-model");
    }

    /**
     * includeManaged 为 false 时，应过滤掉托管资源（以 "cap." 或 "pkg." 前缀开头的 ID）。
     */
    @Test
    void shouldExcludeManagedProfilesWhenIncludeManagedIsFalse() {
        AiModelProfile managed1 = buildProfile("cap.managed-model");
        AiModelProfile managed2 = buildProfile("pkg.internal-model");
        AiModelProfile custom = buildProfile("custom-model");
        when(repository.findAll()).thenReturn(List.of(managed1, managed2, custom));

        List<AiModelProfile> result = service.list(false);

        assertThat(result).hasSize(1)
                .extracting(AiModelProfile::getId)
                .containsExactly("custom-model");
    }

    // ==================== get 测试 ====================

    /**
     * 根据 ID 查询存在的模型配置时，应返回对应的 Profile。
     */
    @Test
    void shouldGetExistingProfile() {
        AiModelProfile profile = buildProfile("existing-id");
        when(repository.findById("existing-id")).thenReturn(Optional.of(profile));

        AiModelProfile result = service.get("existing-id");

        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo("existing-id");
    }

    /**
     * 根据 ID 查询不存在的模型配置时，应抛出 ActionDockException 异常。
     */
    @Test
    void shouldThrowWhenGetNonExistentProfile() {
        when(repository.findById("missing-id")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("missing-id"))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("AI 模型 Profile 不存在")
                .hasMessageContaining("missing-id");
    }

    // ==================== save 校验测试 ====================

    /**
     * 保存模型配置时，如果传入 null，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveNullProfile() {
        assertThatThrownBy(() -> service.save(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * 保存模型配置时，如果 ID 为空，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveProfileWithBlankId() {
        AiModelProfile profile = buildValidProfile().setId("");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile ID 不能为空");
    }

    /**
     * 保存模型配置时，如果 ID 为 null，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveProfileWithNullId() {
        AiModelProfile profile = buildValidProfile().setId(null);

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile ID 不能为空");
    }

    /**
     * 保存模型配置时，如果名称为空，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveProfileWithBlankName() {
        AiModelProfile profile = buildValidProfile().setName("");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 名称不能为空");
    }

    /**
     * 保存模型配置时，如果模型供应商为空，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveProfileWithNullModelProvider() {
        AiModelProfile profile = buildValidProfile().setModelProvider(null);

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("模型供应商不能为空");
    }

    /**
     * 保存模型配置时，如果模型名称为空，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveProfileWithBlankModelName() {
        AiModelProfile profile = buildValidProfile().setModelName("");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("模型名称不能为空");
    }

    // ==================== save 托管资源保护测试 ====================

    /**
     * 保存托管资源（ID 以 "cap." 前缀开头）时，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveManagedProfileWithCapPrefix() {
        AiModelProfile profile = buildValidProfile().setId("cap.some-model");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不允许直接修改")
                .hasMessageContaining("cap.some-model");
    }

    /**
     * 保存托管资源（ID 以 "pkg." 前缀开头）时，应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenSaveManagedProfileWithPkgPrefix() {
        AiModelProfile profile = buildValidProfile().setId("pkg.some-model");

        assertThatThrownBy(() -> service.save(profile))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不允许直接修改")
                .hasMessageContaining("pkg.some-model");
    }

    // ==================== save 成功路径测试 ====================

    /**
     * 保存新的模型配置时，应自动设置 createdAt 和 updatedAt 时间戳。
     */
    @Test
    void shouldSetTimestampsWhenSaveNewProfile() {
        AiModelProfile profile = buildValidProfile();
        when(repository.findById("test-model")).thenReturn(Optional.empty());
        when(repository.save(any(AiModelProfile.class))).thenAnswer(inv -> inv.getArgument(0));

        AiModelProfile result = service.save(profile);

        assertThat(result.getCreatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isNotNull();
        assertThat(result.getCreatedAt()).isEqualTo(result.getUpdatedAt());
        verify(repository).save(profile);
    }

    /**
     * 保存已存在的模型配置时，应保留原有的 createdAt，更新 updatedAt。
     */
    @Test
    void shouldPreserveCreatedAtWhenUpdateExistingProfile() {
        LocalDateTime originalCreatedAt = LocalDateTime.of(2025, 1, 1, 0, 0);
        AiModelProfile existing = buildValidProfile().setCreatedAt(originalCreatedAt);
        AiModelProfile update = buildValidProfile();
        when(repository.findById("test-model")).thenReturn(Optional.of(existing));
        when(repository.save(any(AiModelProfile.class))).thenAnswer(inv -> inv.getArgument(0));

        AiModelProfile result = service.save(update);

        assertThat(result.getCreatedAt()).isEqualTo(originalCreatedAt);
        assertThat(result.getUpdatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isAfter(originalCreatedAt);
    }

    // ==================== delete 测试 ====================

    /**
     * 删除未被引用的自定义模型配置时，应正常调用仓储删除。
     */
    @Test
    void shouldDeleteUnreferencedProfile() {
        when(agentProfileRepository.findAll()).thenReturn(Collections.emptyList());

        service.delete("custom-model");

        verify(repository).deleteById("custom-model");
    }

    /**
     * 删除托管资源时，应抛出 IllegalArgumentException，不执行删除。
     */
    @Test
    void shouldThrowWhenDeleteManagedProfile() {
        assertThatThrownBy(() -> service.delete("cap.managed-model"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不允许直接修改");

        verify(repository, never()).deleteById(anyString());
    }

    /**
     * 删除被 Agent 引用的模型配置时，应抛出 IllegalArgumentException，不执行删除。
     */
    @Test
    void shouldThrowWhenDeleteProfileReferencedByAgent() {
        AiAgentProfile agent = new AiAgentProfile()
                .setId("my-agent")
                .setModelProfileId("target-model");
        when(agentProfileRepository.findAll()).thenReturn(List.of(agent));

        assertThatThrownBy(() -> service.delete("target-model"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("已被 Agent 引用")
                .hasMessageContaining("my-agent");

        verify(repository, never()).deleteById(anyString());
    }

    /**
     * 删除未被 Agent 引用的模型配置时，应正常执行删除（Agent 引用其他模型）。
     */
    @Test
    void shouldDeleteWhenNoAgentReferencesThisProfile() {
        AiAgentProfile agent = new AiAgentProfile()
                .setId("my-agent")
                .setModelProfileId("other-model");
        when(agentProfileRepository.findAll()).thenReturn(List.of(agent));

        service.delete("target-model");

        verify(repository).deleteById("target-model");
    }

    // ==================== 无 agentProfileRepository 的构造路径测试 ====================

    /**
     * 使用单参数构造器时（agentProfileRepository 为 null），删除操作应跳过级联检查直接执行。
     */
    @Test
    void shouldDeleteWithoutCascadeCheckWhenNoAgentRepository() {
        AiModelProfileService serviceWithoutAgent = new AiModelProfileService(repository);

        serviceWithoutAgent.delete("custom-model");

        verify(repository).deleteById("custom-model");
    }

    // ==================== 辅助方法 ====================

    private static AiModelProfile buildProfile(String id) {
        return new AiModelProfile().setId(id);
    }

    private static AiModelProfile buildValidProfile() {
        return new AiModelProfile()
                .setId("test-model")
                .setName("测试模型")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-4");
    }
}
