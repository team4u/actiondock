package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookGroup;
import org.team4u.actiondock.domain.model.PlaybookGuideView;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRefType;
import org.team4u.actiondock.domain.model.PlaybookResolveMatch;
import org.team4u.actiondock.domain.model.PlaybookResolveRequest;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.port.PlaybookGroupRepository;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

public class PlaybookApplicationService {
    private static final String PROJECT_ENTRY_PATH = "ACTIONDOCK.md";

    private final PlaybookGroupRepository groupRepository;
    private final PlaybookRepository playbookRepository;
    private final ScriptRepository scriptRepository;

    public PlaybookApplicationService(PlaybookGroupRepository groupRepository,
                                      PlaybookRepository playbookRepository,
                                      ScriptRepository scriptRepository) {
        this.groupRepository = groupRepository;
        this.playbookRepository = playbookRepository;
        this.scriptRepository = scriptRepository;
    }

    public List<PlaybookGroup> listGroups() {
        return groupRepository.findAll();
    }

    public PlaybookGroup getGroup(String id) {
        return groupRepository.findById(id).orElseThrow(() -> ActionDockException.notFound(
                ActionDockErrorCodes.PLAYBOOK_GROUP_NOT_FOUND,
                "任务分组不存在: " + id,
                Map.of("groupId", id)
        ));
    }

    public PlaybookGroup saveGroup(PlaybookGroup group) {
        return saveGroupInternal(group, false);
    }

    public void deleteGroup(String id) {
        PlaybookGroup group = getGroup(id);
        ensureGroupEditable(group);
        if (playbookRepository.findAll().stream().anyMatch(playbook -> id.equals(playbook.getGroupId()))) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_GROUP_IN_USE,
                    "任务分组仍被任务手册引用: " + id,
                    Map.of("groupId", id)
            );
        }
        groupRepository.deleteById(id);
    }

    public List<Playbook> listPlaybooks(String groupId,
                                        String repositoryId,
                                        String tag,
                                        Boolean enabled,
                                        Boolean managed,
                                        String keyword) {
        String normalizedKeyword = normalizeLower(keyword);
        String normalizedTag = normalizeLower(tag);
        return playbookRepository.findAll().stream()
                .filter(playbook -> groupId == null || groupId.equals(playbook.getGroupId()))
                .filter(playbook -> enabled == null || enabled == playbook.isEnabled())
                .filter(playbook -> managed == null || managed == playbook.isManaged())
                .filter(playbook -> repositoryId == null || playbook.getRepositoryIds().isEmpty() || playbook.getRepositoryIds().contains(repositoryId))
                .filter(playbook -> normalizedTag == null || playbook.getTags().stream().map(this::normalizeLower).anyMatch(normalizedTag::equals))
                .filter(playbook -> normalizedKeyword == null || containsKeyword(playbook, normalizedKeyword))
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

    public PlaybookGroup saveManagedGroup(PlaybookGroup group) {
        return saveGroupInternal(group.setManaged(true), true);
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
        playbook.setGroupId(ApplicationServiceSupport.normalize(playbook.getGroupId(), "groupId 不能为空"));
        if (groupRepository.findById(playbook.getGroupId()).isEmpty()) {
            throw ActionDockException.notFound(
                    ActionDockErrorCodes.PLAYBOOK_GROUP_NOT_FOUND,
                    "任务分组不存在: " + playbook.getGroupId(),
                    Map.of("groupId", playbook.getGroupId())
            );
        }
        playbook.setName(ApplicationServiceSupport.normalize(playbook.getName(), "任务手册名称不能为空"));
        playbook.setDescription(ApplicationServiceSupport.blankToNull(playbook.getDescription()));
        playbook.setIntentAliases(normalizeDistinct(playbook.getIntentAliases()));
        playbook.setTags(normalizeDistinct(playbook.getTags()));
        playbook.setRepositoryIds(normalizeDistinct(playbook.getRepositoryIds()));
        playbook.setKnowledgeRefs(validateKnowledgeRefs(playbook.getKnowledgeRefs()));
        playbook.setScriptRefs(validateScriptRefs(playbook.getScriptRefs()));
        playbook.setGuideMarkdown(ApplicationServiceSupport.normalize(playbook.getGuideMarkdown(), "guideMarkdown 不能为空"));
        playbook.setStopConditions(normalizeDistinct(playbook.getStopConditions()));
        playbook.setUpdatedAt(now);
        return playbookRepository.save(playbook);
    }

    private PlaybookGroup saveGroupInternal(PlaybookGroup group, boolean allowManagedWrite) {
        LocalDateTime now = LocalDateTime.now();
        PlaybookGroup existing = group.getId() == null ? null : groupRepository.findById(group.getId()).orElse(null);
        if (existing != null) {
            ensureGroupEditable(existing, allowManagedWrite);
            group.setCreatedAt(existing.getCreatedAt());
            group.setManaged(allowManagedWrite ? group.isManaged() : existing.isManaged());
        } else {
            group.setCreatedAt(now);
            group.setManaged(allowManagedWrite && group.isManaged());
        }
        group.setId(ApplicationServiceSupport.normalize(group.getId(), "groupId 不能为空"));
        group.setName(ApplicationServiceSupport.normalize(group.getName(), "分组名称不能为空"));
        group.setDescription(ApplicationServiceSupport.blankToNull(group.getDescription()));
        group.setTags(normalizeDistinct(group.getTags()));
        group.setDefaultRepositoryIds(normalizeDistinct(group.getDefaultRepositoryIds()));
        group.setUpdatedAt(now);
        return groupRepository.save(group);
    }

    public Playbook updatePlaybook(String id, Playbook playbook) {
        playbook.setId(id);
        return savePlaybook(playbook);
    }

    public void deletePlaybook(String id) {
        Playbook playbook = getPlaybook(id);
        ensurePlaybookEditable(playbook, false);
        playbookRepository.deleteById(id);
    }

    public void deleteManagedPlaybook(String id) {
        if (playbookRepository.findById(id).isPresent()) {
            playbookRepository.deleteById(id);
        }
    }

    public void deleteManagedGroup(String id) {
        if (groupRepository.findById(id).isPresent()) {
            groupRepository.deleteById(id);
        }
    }

    public PlaybookGuideView guide(String id) {
        Playbook playbook = getPlaybook(id);
        PlaybookGroup group = getGroup(playbook.getGroupId());
        return new PlaybookGuideView(
                playbook,
                group,
                playbook.getKnowledgeRefs(),
                playbook.getScriptRefs(),
                playbook.getGuideMarkdown(),
                playbook.getStopConditions()
        );
    }

    public List<PlaybookResolveMatch> resolve(PlaybookResolveRequest request) {
        String intent = normalizeLower(request == null ? null : request.intent());
        String repositoryId = request == null ? null : ApplicationServiceSupport.blankToNull(request.repositoryId());
        String groupId = request == null ? null : ApplicationServiceSupport.blankToNull(request.groupId());
        Set<String> tags = request == null ? Set.of() : normalizeDistinct(request.tags()).stream()
                .map(this::normalizeLower)
                .filter(Objects::nonNull)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        return playbookRepository.findAll().stream()
                .filter(Playbook::isEnabled)
                .filter(playbook -> groupId == null || groupId.equals(playbook.getGroupId()))
                .filter(playbook -> repositoryId == null || playbook.getRepositoryIds().isEmpty() || playbook.getRepositoryIds().contains(repositoryId))
                .map(playbook -> toResolveMatch(playbook, groupRepository.findById(playbook.getGroupId()).orElse(null), intent, tags))
                .filter(match -> match.score() > 0)
                .sorted(Comparator.comparingInt(PlaybookResolveMatch::score).reversed()
                        .thenComparing(match -> match.playbook().getName(), Comparator.nullsLast(String::compareToIgnoreCase)))
                .limit(10)
                .toList();
    }

    private PlaybookResolveMatch toResolveMatch(Playbook playbook, PlaybookGroup group, String intent, Set<String> tags) {
        int score = score(playbook, group, intent, tags);
        return new PlaybookResolveMatch(
                score,
                playbook,
                group,
                playbook.getRiskLevel(),
                playbook.getKnowledgeRefs().size(),
                playbook.getScriptRefs().size()
        );
    }

    private int score(Playbook playbook, PlaybookGroup group, String intent, Set<String> tags) {
        int score = 0;
        if (intent != null) {
            Pattern pattern;
            try {
                pattern = Pattern.compile(intent, Pattern.CASE_INSENSITIVE);
            } catch (Exception e) {
                pattern = Pattern.compile(Pattern.quote(intent), Pattern.CASE_INSENSITIVE);
            }

            final Pattern finalPattern = pattern;
            if (playbook.getIntentAliases().stream().anyMatch(alias -> matches(finalPattern, alias))) {
                score += 100;
            }
            if (matches(pattern, playbook.getName())) {
                score += 50;
            }
            if (matches(pattern, playbook.getDescription())) {
                score += 30;
            }
            if (playbook.getTags().stream().anyMatch(tag -> matches(finalPattern, tag))) {
                score += 20;
            }
            if (group != null && matches(pattern, group.getName())) {
                score += 10;
            }
            if (group != null && group.getTags().stream().anyMatch(tag -> matches(finalPattern, tag))) {
                score += 10;
            }
        }
        if (!tags.isEmpty()) {
            Set<String> playbookTags = playbook.getTags().stream()
                    .map(this::normalizeLower)
                    .filter(Objects::nonNull)
                    .collect(java.util.stream.Collectors.toSet());
            for (String tag : tags) {
                if (playbookTags.contains(tag)) {
                    score += 15;
                }
            }
        }
        return score;
    }

    private boolean matches(Pattern pattern, String value) {
        return value != null && pattern.matcher(value).find();
    }

    private List<PlaybookKnowledgeRef> validateKnowledgeRefs(List<PlaybookKnowledgeRef> refs) {
        return refs.stream().map(ref -> {
            PlaybookKnowledgeRefType type = ref.getType() == null ? PlaybookKnowledgeRefType.FILE : ref.getType();
            String repositoryId = ApplicationServiceSupport.normalize(ref.getRepositoryId(), "knowledgeRefs.repositoryId 不能为空");
            String path = ApplicationServiceSupport.normalize(ref.getPath(), "knowledgeRefs.path 不能为空");
            if (type == PlaybookKnowledgeRefType.ENTRY && !PROJECT_ENTRY_PATH.equals(path)) {
                throw new IllegalArgumentException("ENTRY knowledgeRefs.path 必须为 ACTIONDOCK.md");
            }
            if (type == PlaybookKnowledgeRefType.FILE && (path.startsWith("/") || path.contains(".."))) {
                throw new IllegalArgumentException("FILE knowledgeRefs.path 必须为仓库内相对路径");
            }
            return new PlaybookKnowledgeRef().setType(type).setRepositoryId(repositoryId).setPath(path);
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

    private boolean containsKeyword(Playbook playbook, String keyword) {
        return contains(playbook.getId(), keyword)
                || contains(playbook.getName(), keyword)
                || contains(playbook.getDescription(), keyword)
                || playbook.getIntentAliases().stream().anyMatch(value -> contains(value, keyword))
                || playbook.getTags().stream().anyMatch(value -> contains(value, keyword));
    }

    private boolean contains(String value, String keyword) {
        return value != null && keyword != null && value.toLowerCase(Locale.ROOT).contains(keyword);
    }

    private String normalizeLower(String value) {
        String normalized = ApplicationServiceSupport.blankToNull(value);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private List<String> normalizeDistinct(List<String> values) {
        return values == null ? List.of() : values.stream()
                .map(ApplicationServiceSupport::blankToNull)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
    }

    private void ensureGroupEditable(PlaybookGroup group) {
        ensureGroupEditable(group, false);
    }

    private void ensureGroupEditable(PlaybookGroup group, boolean allowManagedWrite) {
        if (group.isManaged() && !allowManagedWrite) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_GROUP_NOT_EDITABLE,
                    "能力包安装的任务分组为只读",
                    Map.of("groupId", group.getId())
            );
        }
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
