package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookAgentSkillRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookPage;
import org.team4u.actiondock.domain.model.PlaybookQuery;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.storage.jpa.entity.PlaybookEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaPlaybookRepositoryAdapter implements PlaybookRepository {
    private final SpringDataPlaybookRepository repository;
    private final JsonCodec jsonCodec;

    public JpaPlaybookRepositoryAdapter(SpringDataPlaybookRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public Playbook save(Playbook playbook) {
        return toDomain(repository.save(toEntity(playbook)));
    }

    @Override
    public Optional<Playbook> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<Playbook> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public List<Playbook> findByQuery(PlaybookQuery query) {
        if (query == null) {
            return findAll();
        }
        if (query.isPaged()) {
            return findEntityPage(query).getContent().stream().map(this::toDomain).toList();
        }
        // 未启用分页时返回全部匹配记录（pageable 设为不限制大小）
        Pageable unpageable = Pageable.ofSize(Integer.MAX_VALUE).withPage(0);
        return repository.findByConditions(
                        query.enabled(),
                        query.managed(),
                        buildTagLike(query.tag()),
                        buildRepositoryIdLike(query.repositoryId()),
                        unpageable)
                .getContent().stream().map(this::toDomain).toList();
    }

    @Override
    public PlaybookPage findPage(PlaybookQuery query) {
        PlaybookQuery effective = query == null ? new PlaybookQuery(null, null, null, null, 0, 20) : query;
        int pageIndex = effective.pageIndex();
        int pageSize = effective.pageSize() <= 0 ? 20 : effective.pageSize();
        Page<PlaybookEntity> page = repository.findByConditions(
                effective.enabled(),
                effective.managed(),
                buildTagLike(effective.tag()),
                buildRepositoryIdLike(effective.repositoryId()),
                // 排序由 @Query 内的 order by 子句定义，此处不额外传 Sort 以避免冲突
                PageRequest.of(pageIndex, pageSize));
        List<Playbook> items = page.getContent().stream().map(this::toDomain).toList();
        return new PlaybookPage(items, pageIndex, pageSize, page.getTotalElements(), page.getTotalPages());
    }

    @Override
    public List<Playbook> findReferencingPlaybooks(String playbookId) {
        if (playbookId == null || playbookId.isBlank()) {
            return List.of();
        }
        // relatedPlaybookRefs 以 JSON 数组存储（如 [{"playbookId":"x"}]），采用 LIKE 匹配元素
        return repository.findReferencingByPlaybookId(buildJsonElementLike(playbookId)).stream()
                .map(this::toDomain)
                .toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private Page<PlaybookEntity> findEntityPage(PlaybookQuery query) {
        // 排序由 @Query 内的 order by 子句定义，此处不额外传 Sort 以避免冲突
        return repository.findByConditions(
                query.enabled(),
                query.managed(),
                buildTagLike(query.tag()),
                buildRepositoryIdLike(query.repositoryId()),
                PageRequest.of(query.pageIndex(), query.pageSize()));
    }

    /**
     * 构造标签 LIKE 模式：匹配 JSON 数组中的字符串元素（如 ["refund"]）。
     * <p>
     * 标签匹配大小写不敏感，查询时对 tagsJson 做 lower()，故此处亦转为小写。
     * 标签值为受控标识符，通常不含 SQL 通配符，因此不做转义。
     *
     * @param tag 标签原文，null 表示不过滤
     * @return LIKE 模式，如 %refund%；null 表示不过滤
     */
    private String buildTagLike(String tag) {
        if (tag == null || tag.isBlank()) {
            return null;
        }
        return "%" + tag.trim().toLowerCase(java.util.Locale.ROOT) + "%";
    }

    /**
     * 构造 repositoryId LIKE 模式：匹配 JSON 数组中的字符串元素（如 ["billing-service"]）。
     * <p>
     * repositoryId 为受控标识符，通常不含 SQL 通配符，因此不做转义。
     *
     * @param repositoryId 仓库 ID 原文，null 表示不过滤
     * @return LIKE 模式，如 %billing-service%；null 表示不过滤
     */
    private String buildRepositoryIdLike(String repositoryId) {
        if (repositoryId == null || repositoryId.isBlank()) {
            return null;
        }
        return "%" + repositoryId.trim() + "%";
    }

    /**
     * 构造 JSON 数组元素 LIKE 模式（用于 relatedPlaybookRefs 的 playbookId 字段匹配）。
     *
     * @param element 匹配元素
     * @return LIKE 模式
     */
    private String buildJsonElementLike(String element) {
        return "%" + element + "%";
    }

    private PlaybookEntity toEntity(Playbook playbook) {
        PlaybookEntity entity = new PlaybookEntity();
        entity.setId(playbook.getId());
        entity.setName(playbook.getName());
        entity.setDescription(playbook.getDescription());
        entity.setTagsJson(jsonCodec.write(playbook.getTags()));
        entity.setRiskLevel(playbook.getRiskLevel() == null ? null : playbook.getRiskLevel().name());
        entity.setRepositoryIdsJson(jsonCodec.write(playbook.getRepositoryIds()));
        entity.setKnowledgeRefsJson(jsonCodec.write(playbook.getKnowledgeRefs()));
        entity.setScriptRefsJson(jsonCodec.write(playbook.getScriptRefs()));
        entity.setAgentSkillRefsJson(jsonCodec.write(playbook.getAgentSkillRefs()));
        entity.setRelatedPlaybookRefsJson(jsonCodec.write(playbook.getRelatedPlaybookRefs()));
        entity.setGuideMarkdown(playbook.getGuideMarkdown());
        entity.setStopConditionsJson(jsonCodec.write(playbook.getStopConditions()));
        entity.setEnabled(playbook.isEnabled());
        entity.setManaged(playbook.isManaged());
        entity.setCreatedAt(playbook.getCreatedAt());
        entity.setUpdatedAt(playbook.getUpdatedAt());
        return entity;
    }

    private Playbook toDomain(PlaybookEntity entity) {
        return new Playbook()
                .setId(entity.getId())
                .setName(entity.getName())
                .setDescription(entity.getDescription())
                .setTags(jsonCodec.readList(entity.getTagsJson(), String.class))
                .setRiskLevel(entity.getRiskLevel() == null || entity.getRiskLevel().isBlank()
                        ? null
                        : PlaybookRiskLevel.valueOf(entity.getRiskLevel()))
                .setRepositoryIds(jsonCodec.readList(entity.getRepositoryIdsJson(), String.class))
                .setKnowledgeRefs(jsonCodec.readList(entity.getKnowledgeRefsJson(), PlaybookKnowledgeRef.class))
                .setScriptRefs(jsonCodec.readList(entity.getScriptRefsJson(), PlaybookScriptRef.class))
                .setAgentSkillRefs(jsonCodec.readList(entity.getAgentSkillRefsJson(), PlaybookAgentSkillRef.class))
                .setRelatedPlaybookRefs(jsonCodec.readList(entity.getRelatedPlaybookRefsJson(), PlaybookRelatedRef.class))
                .setGuideMarkdown(entity.getGuideMarkdown())
                .setStopConditions(jsonCodec.readList(entity.getStopConditionsJson(), String.class))
                .setEnabled(entity.isEnabled())
                .setManaged(entity.isManaged())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
