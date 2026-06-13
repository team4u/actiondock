package org.team4u.actiondock.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookPage;
import org.team4u.actiondock.domain.model.PlaybookQuery;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.storage.jpa.json.JacksonJsonCodec;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookRepository;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JpaPlaybookRepositoryAdapter 下推查询与分页的真实 H2 集成测试。
 *
 * @author jay.wu
 */
@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
@EntityScan("org.team4u.actiondock.storage.jpa.entity")
@EnableJpaRepositories("org.team4u.actiondock.storage.jpa.repo")
class JpaPlaybookRepositoryAdapterTest {
    @Autowired
    private SpringDataPlaybookRepository springDataRepository;

    private JpaPlaybookRepositoryAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new JpaPlaybookRepositoryAdapter(springDataRepository, new JacksonJsonCodec(new ObjectMapper()));
    }

    @Test
    void findByQueryFiltersByEnabledManagedTagAndRepositoryId() {
        adapter.save(playbook("refund", "退款排查", List.of("refund"), List.of("billing"), true, false));
        adapter.save(playbook("billing", "账单", List.of("billing"), List.of("billing"), false, false));
        adapter.save(playbook("global", "全局", List.of("ops"), List.of(), true, true));
        // 未关联仓库的任务手册（repositoryIds 为空）应匹配任意 repositoryId
        adapter.save(playbook("unbound", "无仓库", List.of("ops"), List.of(), true, false));

        List<Playbook> result = adapter.findByQuery(
                new PlaybookQuery("billing", "refund", true, null, null, null));
        assertThat(result).extracting(Playbook::getId).containsExactly("refund");

        // enabled/managed 直接列下推
        List<Playbook> managedOnly = adapter.findByQuery(
                new PlaybookQuery(null, null, null, true, null, null));
        assertThat(managedOnly).extracting(Playbook::getId).containsExactly("global");

        // repositoryId=billing 时，未关联仓库的 unbound / global 也应命中（保留既有语义）
        List<Playbook> byRepo = adapter.findByQuery(
                new PlaybookQuery("billing", null, null, null, null, null));
        assertThat(byRepo).extracting(Playbook::getId)
                .containsExactlyInAnyOrder("refund", "billing", "unbound", "global");
    }

    @Test
    void findByQueryAppliesPaging() {
        for (int i = 0; i < 5; i++) {
            adapter.save(playbook("p" + i, "name" + i, List.of("tag"), List.of("repo"), true, false));
        }

        // 第 0 页（size=2）应返回 2 条
        List<Playbook> page0 = adapter.findByQuery(
                new PlaybookQuery("repo", null, true, null, 0, 2));
        assertThat(page0).hasSize(2);

        // 第 2 页（size=2）应只返回 1 条（共 5 条）
        List<Playbook> page2 = adapter.findByQuery(
                new PlaybookQuery("repo", null, true, null, 2, 2));
        assertThat(page2).hasSize(1);
    }

    @Test
    void findPageReturnsTotals() {
        for (int i = 0; i < 3; i++) {
            adapter.save(playbook("p" + i, "name" + i, List.of("tag"), List.of("repo"), true, false));
        }

        PlaybookPage page = adapter.findPage(new PlaybookQuery("repo", null, true, null, 0, 2));
        assertThat(page.items()).hasSize(2);
        assertThat(page.totalElements()).isEqualTo(3L);
        assertThat(page.totalPages()).isEqualTo(2);
        assertThat(page.page()).isZero();
        assertThat(page.size()).isEqualTo(2);
    }

    @Test
    void findReferencingPlaybooksReturnsOnlyReferencing() {
        // target 被 referrer 引用，independent 不引用
        adapter.save(playbook("target", "目标", List.of("t"), List.of(), true, false));
        Playbook referrer = playbook("referrer", "引用者", List.of("t"), List.of(), true, false);
        referrer.setRelatedPlaybookRefs(List.of(new PlaybookRelatedRef().setPlaybookId("target")));
        adapter.save(referrer);
        adapter.save(playbook("independent", "独立", List.of("t"), List.of(), true, false));

        List<Playbook> referencing = adapter.findReferencingPlaybooks("target");
        assertThat(referencing).extracting(Playbook::getId).containsExactly("referrer");
    }

    private static Playbook playbook(String id, String name, List<String> tags, List<String> repositoryIds,
                                     boolean enabled, boolean managed) {
        return new Playbook()
                .setId(id)
                .setName(name)
                .setTags(tags)
                .setRepositoryIds(repositoryIds)
                .setEnabled(enabled)
                .setManaged(managed)
                .setRiskLevel(PlaybookRiskLevel.MEDIUM)
                .setGuideMarkdown("guide")
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now());
    }

    /** 仅为 @DataJpaTest 提供最小配置锚点。 */
    @SpringBootConfiguration
    @EnableAutoConfiguration
    static class TestConfig {
    }
}
