package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookAgentSkillRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRefType;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRefRelation;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public class PlaybookApplicationService {
    private final PlaybookRepository playbookRepository;
    private final ScriptRepository scriptRepository;

    public PlaybookApplicationService(PlaybookRepository playbookRepository,
                                      ScriptRepository scriptRepository) {
        this.playbookRepository = playbookRepository;
        this.scriptRepository = scriptRepository;
    }

    public List<Playbook> listPlaybooks(String repositoryId,
                                        String tag,
                                        Boolean enabled,
                                        Boolean managed) {
        String normalizedTag = normalizeLower(tag);
        return playbookRepository.findAll().stream()
                .filter(playbook -> enabled == null || enabled == playbook.isEnabled())
                .filter(playbook -> managed == null || managed == playbook.isManaged())
                .filter(playbook -> repositoryId == null || playbook.getRepositoryIds().isEmpty() || playbook.getRepositoryIds().contains(repositoryId))
                .filter(playbook -> normalizedTag == null || playbook.getTags().stream().map(this::normalizeLower).anyMatch(normalizedTag::equals))
                .toList();
    }

    public Playbook getPlaybook(String id) {
        return playbookRepository.findById(id).orElseThrow(() -> ActionDockException.notFound(
                ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                "任务手册不存在: " + id,
                Map.of("playbookId", id)
        ));
    }

    public Playbook savePlaybook(Playbook playbook) {
        return savePlaybook(playbook, false);
    }

    public Playbook saveManagedPlaybook(Playbook playbook) {
        return savePlaybook(playbook.setManaged(true), true);
    }

    private Playbook savePlaybook(Playbook playbook, boolean allowManagedWrite) {
        LocalDateTime now = LocalDateTime.now();
        Playbook existing = playbook.getId() == null ? null : playbookRepository.findById(playbook.getId()).orElse(null);
        if (existing != null) {
            ensurePlaybookEditable(existing, allowManagedWrite);
            playbook.setCreatedAt(existing.getCreatedAt());
            playbook.setManaged(allowManagedWrite ? playbook.isManaged() : existing.isManaged());
        } else {
            playbook.setCreatedAt(now);
            playbook.setManaged(allowManagedWrite && playbook.isManaged());
        }
        playbook.setId(ApplicationServiceSupport.normalize(playbook.getId(), "playbookId 不能为空"));
        playbook.setName(ApplicationServiceSupport.normalize(playbook.getName(), "任务手册名称不能为空"));
        playbook.setDescription(ApplicationServiceSupport.blankToNull(playbook.getDescription()));
        playbook.setTags(normalizeDistinct(playbook.getTags()));
        playbook.setRepositoryIds(normalizeDistinct(playbook.getRepositoryIds()));
        playbook.setKnowledgeRefs(validateKnowledgeRefs(playbook.getKnowledgeRefs()));
        playbook.setScriptRefs(validateScriptRefs(playbook.getScriptRefs()));
        playbook.setAgentSkillRefs(validateAgentSkillRefs(playbook.getAgentSkillRefs()));
        playbook.setRelatedPlaybookRefs(validateRelatedPlaybookRefs(playbook.getId(), playbook.getRelatedPlaybookRefs()));
        playbook.setGuideMarkdown(ApplicationServiceSupport.normalize(playbook.getGuideMarkdown(), "guideMarkdown 不能为空"));
        playbook.setStopConditions(normalizeDistinct(playbook.getStopConditions()));
        playbook.setUpdatedAt(now);
        return playbookRepository.save(playbook);
    }

    public Playbook updatePlaybook(String id, Playbook playbook) {
        playbook.setId(id);
        return savePlaybook(playbook);
    }

    public void deletePlaybook(String id) {
        Playbook playbook = getPlaybook(id);
        ensurePlaybookEditable(playbook, false);
        List<Playbook> allPlaybooks = playbookRepository.findAll();
        List<String> referencingPlaybookIds = allPlaybooks.stream()
                .filter(p -> !p.getId().equals(id))
                .filter(p -> p.getRelatedPlaybookRefs().stream()
                        .anyMatch(ref -> id.equals(ref.getPlaybookId())))
                .map(Playbook::getId)
                .toList();
        if (!referencingPlaybookIds.isEmpty()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_IN_USE,
                    "无法删除任务手册，因为它被其他任务手册引用",
                    Map.of("referencingPlaybookIds", referencingPlaybookIds)
            );
        }
        playbookRepository.deleteById(id);
    }

    public void deleteManagedPlaybook(String id) {
        if (playbookRepository.findById(id).isPresent()) {
            playbookRepository.deleteById(id);
        }
    }

    private List<PlaybookKnowledgeRef> validateKnowledgeRefs(List<PlaybookKnowledgeRef> refs) {
        return refs.stream().map(ref -> {
            PlaybookKnowledgeRefType type = ref.getType() == null ? PlaybookKnowledgeRefType.FILE : ref.getType();
            String repositoryId = ApplicationServiceSupport.normalize(ref.getRepositoryId(), "knowledgeRefs.repositoryId 不能为空");
            PlaybookKnowledgeRef normalized = new PlaybookKnowledgeRef().setType(type).setRepositoryId(repositoryId);
            if (type == PlaybookKnowledgeRefType.NOTE) {
                return normalized.setMarkdown(ApplicationServiceSupport.normalize(ref.getMarkdown(), "knowledgeRefs.markdown 不能为空"));
            }
            String path = ApplicationServiceSupport.normalize(ref.getPath(), "knowledgeRefs.path 不能为空");
            if (path.startsWith("/") || path.contains("..")) {
                throw new IllegalArgumentException("FILE knowledgeRefs.path 必须为仓库内相对路径");
            }
            if ("ACTIONDOCK.md".equals(path)) {
                throw new IllegalArgumentException("ACTIONDOCK.md 为默认入口文档，不应作为显式 knowledgeRefs.file 添加");
            }
            return normalized.setPath(path);
        }).toList();
    }

    private List<PlaybookScriptRef> validateScriptRefs(List<PlaybookScriptRef> refs) {
        return refs.stream().map(ref -> {
            String scriptId = ApplicationServiceSupport.normalize(ref.getScriptId(), "scriptRefs.scriptId 不能为空");
            if (scriptRepository.findById(scriptId).isEmpty()) {
                throw ActionDockException.notFound(
                        ActionDockErrorCodes.SCRIPT_NOT_FOUND,
                        "脚本不存在: " + scriptId,
                        Map.of("scriptId", scriptId)
                );
            }
            return new PlaybookScriptRef()
                    .setScriptId(scriptId)
                    .setPurpose(ApplicationServiceSupport.blankToNull(ref.getPurpose()));
        }).toList();
    }

    private List<PlaybookAgentSkillRef> validateAgentSkillRefs(List<PlaybookAgentSkillRef> refs) {
        return refs.stream().map(ref -> {
            String skillId = ApplicationServiceSupport.normalize(ref.getSkillId(), "agentSkillRefs.skillId 不能为空");
            return new PlaybookAgentSkillRef()
                    .setSkillId(skillId)
                    .setPurpose(ApplicationServiceSupport.blankToNull(ref.getPurpose()))
                    .setRequired(ref.isRequired());
        }).toList();
    }

    private List<PlaybookRelatedRef> validateRelatedPlaybookRefs(String currentPlaybookId, List<PlaybookRelatedRef> refs) {
        return refs.stream().map(ref -> {
            String playbookId = ApplicationServiceSupport.normalize(ref.getPlaybookId(), "relatedPlaybookRefs.playbookId 不能为空");
            if (playbookId.equals(currentPlaybookId)) {
                throw new IllegalArgumentException("relatedPlaybookRefs.playbookId 不能引用当前任务手册");
            }
            if (playbookRepository.findById(playbookId).isEmpty()) {
                throw ActionDockException.notFound(
                        ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                        "关联任务手册不存在: " + playbookId,
                        Map.of("playbookId", playbookId)
                );
            }
            PlaybookRelatedRefRelation relation = ref.getRelation() == null ? PlaybookRelatedRefRelation.RELATED : ref.getRelation();
            return new PlaybookRelatedRef()
                    .setPlaybookId(playbookId)
                    .setRelation(relation)
                    .setPurpose(ApplicationServiceSupport.blankToNull(ref.getPurpose()));
        }).toList();
    }

    private String normalizeLower(String value) {
        String normalized = ApplicationServiceSupport.blankToNull(value);
        return normalized == null ? null : normalized.toLowerCase(java.util.Locale.ROOT);
    }

    private List<String> normalizeDistinct(List<String> values) {
        return values == null ? List.of() : values.stream()
                .map(ApplicationServiceSupport::blankToNull)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
    }

    private void ensurePlaybookEditable(Playbook playbook, boolean allowManagedWrite) {
        if (playbook.isManaged() && !allowManagedWrite) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_NOT_EDITABLE,
                    "能力包安装的任务手册为只读",
                    Map.of("playbookId", playbook.getId())
            );
        }
    }
}
