package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookAgentSkillRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRefType;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRefRelation;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.ScriptDefinition;
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
    private final InMemoryPlaybookRepository playbookRepository = new InMemoryPlaybookRepository();
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final PlaybookApplicationService service = new PlaybookApplicationService(playbookRepository, scriptRepository);

    @Test
    void savesPlaybook() {
        when(scriptRepository.findById("query-log")).thenReturn(Optional.of(new ScriptDefinition().setId("query-log")));
        // Save target playbook first
        service.savePlaybook(new Playbook().setId("generic-project-investigation").setName("通用").setGuideMarkdown("guide"));

        Playbook saved = service.savePlaybook(new Playbook()
                .setId("refund")
                .setName("退款失败排查")
                .setRiskLevel(PlaybookRiskLevel.MEDIUM)
                .setRepositoryIds(List.of("billing-service"))
                .setKnowledgeRefs(List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.NOTE)
                        .setRepositoryId("billing-service")
                        .setMarkdown("先看退款链路背景。")))
                .setScriptRefs(List.of(new PlaybookScriptRef().setScriptId("query-log").setPurpose("查询日志")))
                .setAgentSkillRefs(List.of(new PlaybookAgentSkillRef()
                        .setSkillId("openai-docs")
                        .setPurpose("查官方文档")
                        .setRequired(false)))
                .setRelatedPlaybookRefs(List.of(new PlaybookRelatedRef()
                        .setPlaybookId("generic-project-investigation")
                        .setRelation(PlaybookRelatedRefRelation.FALLBACK)
                        .setPurpose("退回通用项目调查")))
                .setGuideMarkdown("先看知识，再运行脚本。")
                .setStopConditions(List.of("缺少上下文")));

        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(service.getPlaybook("refund").getKnowledgeRefs()).hasSize(1);
        assertThat(service.getPlaybook("refund").getAgentSkillRefs()).extracting(PlaybookAgentSkillRef::getSkillId)
                .containsExactly("openai-docs");
        assertThat(service.getPlaybook("refund").getRelatedPlaybookRefs()).extracting(PlaybookRelatedRef::getRelation)
                .containsExactly(PlaybookRelatedRefRelation.FALLBACK);
    }

    @Test
    void rejectsMissingRelatedPlaybookRefs() {
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setName("P1")
                .setRelatedPlaybookRefs(List.of(new PlaybookRelatedRef().setPlaybookId("non-existent-target")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("关联任务手册不存在");
    }

    @Test
    void protectsPlaybookFromDeletionWhenReferenced() {
        service.savePlaybook(new Playbook().setId("target").setName("Target").setGuideMarkdown("guide"));
        service.savePlaybook(new Playbook()
                .setId("referrer")
                .setName("Referrer")
                .setRelatedPlaybookRefs(List.of(new PlaybookRelatedRef().setPlaybookId("target")))
                .setGuideMarkdown("guide"));

        assertThatThrownBy(() -> service.deletePlaybook("target"))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("被其他任务手册引用");
    }

    @Test
    void rejectsMissingGroupGuideAndScript() {
        when(scriptRepository.findById("missing-script")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p2")
                .setName("P2")
                .setScriptRefs(List.of(new PlaybookScriptRef().setScriptId("missing-script")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(ActionDockException.class);

        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p3")
                .setName("P3")
                .setGuideMarkdown(" ")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsInvalidKnowledgeRef() {
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setName("P1")
                .setKnowledgeRefs(List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.FILE)
                        .setRepositoryId("repo")
                        .setPath("../README.md")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("仓库内相对路径");
    }

    @Test
    void rejectsActiondockEntryFileAndEmptyNoteMarkdown() {
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setName("P1")
                .setKnowledgeRefs(List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.FILE)
                        .setRepositoryId("repo")
                        .setPath("ACTIONDOCK.md")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("默认入口文档");

        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p2")
                .setName("P2")
                .setKnowledgeRefs(List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.NOTE)
                        .setRepositoryId("repo")
                        .setMarkdown(" ")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("knowledgeRefs.markdown");
    }

    @Test
    void listsPlaybooksByTagAndRepository() {
        service.savePlaybook(new Playbook()
                .setId("refund")
                .setName("退款失败排查")
                .setTags(List.of("refund"))
                .setRepositoryIds(List.of("billing-service"))
                .setGuideMarkdown("guide"));
        service.savePlaybook(new Playbook()
                .setId("global")
                .setName("全局账单排查")
                .setTags(List.of("billing"))
                .setGuideMarkdown("guide"));

        assertThat(service.listPlaybooks("billing-service", "refund", true, null))
                .extracting(Playbook::getId)
                .containsExactly("refund");
    }

    @Test
    void rejectsDirectManagedEditsAndDeletes() {
        service.saveManagedPlaybook(new Playbook().setId("p1").setName("P1").setGuideMarkdown("guide"));

        assertThatThrownBy(() -> service.deletePlaybook("p1"))
                .isInstanceOf(ActionDockException.class);
    }

    @Test
    void normalSavesCannotCreateManagedAssets() {
        Playbook playbook = service.savePlaybook(new Playbook()
                .setId("p1")
                .setName("P1")
                .setManaged(true)
                .setGuideMarkdown("guide"));

        assertThat(playbook.isManaged()).isFalse();
    }

    @Test
    void rejectsEmptyAgentSkillAndSelfRelatedPlaybookRefs() {
        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setName("P1")
                .setAgentSkillRefs(List.of(new PlaybookAgentSkillRef().setSkillId(" ")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("agentSkillRefs.skillId");

        assertThatThrownBy(() -> service.savePlaybook(new Playbook()
                .setId("p1")
                .setName("P1")
                .setRelatedPlaybookRefs(List.of(new PlaybookRelatedRef().setPlaybookId("p1")))
                .setGuideMarkdown("guide")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能引用当前任务手册");
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
