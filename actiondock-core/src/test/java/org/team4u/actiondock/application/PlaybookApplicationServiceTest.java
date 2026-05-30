package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookGroup;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRefType;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.port.PlaybookGroupRepository;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaybookApplicationServiceTest {
    private final InMemoryPlaybookGroupRepository groupRepository = new InMemoryPlaybookGroupRepository();
    private final InMemoryPlaybookRepository playbookRepository = new InMemoryPlaybookRepository();
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final PlaybookApplicationService service = new PlaybookApplicationService(groupRepository, playbookRepository, scriptRepository);

    @Test
    void savesPlaybookAndGuide() {
        when(scriptRepository.findById("query-log")).thenReturn(Optional.of(new ScriptDefinition().setId("query-log")));
        service.saveGroup(new PlaybookGroup().setId("billing").setName("Billing").setTags(List.of("billing")));

        Playbook saved = service.savePlaybook(new Playbook()
                .setId("refund")
                .setGroupId("billing")
                .setName("退款失败排查")
                .setIntentAliases(List.of("退款失败"))
                .setRiskLevel(PlaybookRiskLevel.MEDIUM)
                .setRepositoryIds(List.of("billing-service"))
                .setKnowledgeRefs(List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.ENTRY)
                        .setRepositoryId("billing-service")
                        .setPath("ACTIONDOCK.md")))
                .setScriptRefs(List.of(new PlaybookScriptRef().setScriptId("query-log").setPurpose("查询日志")))
                .setGuideMarkdown("先看知识，再运行脚本。")
                .setStopConditions(List.of("缺少上下文")));

        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(service.guide("refund").group().getId()).isEqualTo("billing");
        assertThat(service.guide("refund").knowledgeRefs()).hasSize(1);
    }

    @Test
    void rejectsMissingGroupGuideAndScript() {
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setGroupId("missing")
                .setName("P1")
                .setGuideMarkdown("guide")))
                .isInstanceOf(ActionDockException.class);

        service.saveGroup(new PlaybookGroup().setId("g1").setName("G1"));
        when(scriptRepository.findById("missing-script")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p2")
                .setGroupId("g1")
                .setName("P2")
                .setScriptRefs(List.of(new PlaybookScriptRef().setScriptId("missing-script")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(ActionDockException.class);

        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p3")
                .setGroupId("g1")
                .setName("P3")
                .setGuideMarkdown(" ")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsInvalidKnowledgeRef() {
        service.saveGroup(new PlaybookGroup().setId("g1").setName("G1"));

        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setGroupId("g1")
                .setName("P1")
                .setKnowledgeRefs(List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.ENTRY)
                        .setRepositoryId("repo")
                        .setPath("README.md")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ACTIONDOCK.md");
    }

    @Test
    void preventsDeletingReferencedGroup() {
        service.saveGroup(new PlaybookGroup().setId("g1").setName("G1"));
        service.savePlaybook(new Playbook().setId("p1").setGroupId("g1").setName("P1").setGuideMarkdown("guide"));

        assertThatThrownBy(() -> service.deleteGroup("g1"))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("仍被任务手册引用");
    }

    @Test
    void resolvesByAliasNameTagAndRepository() {
        service.saveGroup(new PlaybookGroup().setId("billing").setName("Billing").setTags(List.of("finance")));
        service.savePlaybook(new Playbook()
                .setId("refund")
                .setGroupId("billing")
                .setName("退款失败排查")
                .setIntentAliases(List.of("退款失败"))
                .setTags(List.of("refund"))
                .setRepositoryIds(List.of("billing-service"))
                .setGuideMarkdown("guide"));
        service.savePlaybook(new Playbook()
                .setId("global")
                .setGroupId("billing")
                .setName("全局账单排查")
                .setTags(List.of("billing"))
                .setGuideMarkdown("guide"));

        assertThat(service.resolve(new org.team4u.actiondock.domain.model.PlaybookResolveRequest(
                "退款失败", "billing-service", null, List.of("refund"))))
                .extracting(match -> match.playbook().getId())
                .containsExactly("refund");
    }

    @Test
    void rejectsDirectManagedEditsAndDeletes() {
        service.saveManagedGroup(new PlaybookGroup().setId("g1").setName("G1"));
        service.saveManagedPlaybook(new Playbook().setId("p1").setGroupId("g1").setName("P1").setGuideMarkdown("guide"));

        assertThatThrownBy(() -> service.saveGroup(new PlaybookGroup().setId("g1").setName("Changed")))
                .isInstanceOf(ActionDockException.class);
        assertThatThrownBy(() -> service.deletePlaybook("p1"))
                .isInstanceOf(ActionDockException.class);
    }

    @Test
    void normalSavesCannotCreateManagedAssets() {
        PlaybookGroup group = service.saveGroup(new PlaybookGroup()
                .setId("g1")
                .setName("G1")
                .setManaged(true));
        Playbook playbook = service.savePlaybook(new Playbook()
                .setId("p1")
                .setGroupId("g1")
                .setName("P1")
                .setManaged(true)
                .setGuideMarkdown("guide"));

        assertThat(group.isManaged()).isFalse();
        assertThat(playbook.isManaged()).isFalse();
    }

    private static final class InMemoryPlaybookGroupRepository implements PlaybookGroupRepository {
        private final Map<String, PlaybookGroup> items = new LinkedHashMap<>();

        @Override
        public PlaybookGroup save(PlaybookGroup group) {
            items.put(group.getId(), group);
            return group;
        }

        @Override
        public Optional<PlaybookGroup> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<PlaybookGroup> findAll() {
            return new ArrayList<>(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }

    private static final class InMemoryPlaybookRepository implements PlaybookRepository {
        private final Map<String, Playbook> items = new LinkedHashMap<>();

        @Override
        public Playbook save(Playbook playbook) {
            items.put(playbook.getId(), playbook);
            return playbook;
        }

        @Override
        public Optional<Playbook> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<Playbook> findAll() {
            return new ArrayList<>(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }
}
