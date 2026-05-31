package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRefType;
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
                .setGuideMarkdown("先看知识，再运行脚本。")
                .setStopConditions(List.of("缺少上下文")));

        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(service.getPlaybook("refund").getKnowledgeRefs()).hasSize(1);
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
    void listsPlaybooksByKeywordTagAndRepository() {
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

        assertThat(service.listPlaybooks("billing-service", "refund", true, null, "退款失败"))
                .extracting(Playbook::getId)
                .containsExactly("refund");
    }

    @Test
    void listsPlaybooksByKeywordAcrossNameDescriptionAndTags() {
        service.savePlaybook(new Playbook()
                .setId("refund")
                .setName("退款失败排查")
                .setDescription("定位退款失败根因")
                .setTags(List.of("refund"))
                .setGuideMarkdown("guide"));
        service.savePlaybook(new Playbook()
                .setId("timeout")
                .setName("超时排查")
                .setTags(List.of("timeout"))
                .setGuideMarkdown("guide"));

        assertThat(service.listPlaybooks(null, null, null, null, "退款"))
                .extracting(Playbook::getId)
                .containsExactly("refund");
        assertThat(service.listPlaybooks(null, null, null, null, "timeout"))
                .extracting(Playbook::getId)
                .containsExactly("timeout");
        assertThat(service.listPlaybooks(null, null, null, null, "[invalid"))
                .isEmpty();
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
