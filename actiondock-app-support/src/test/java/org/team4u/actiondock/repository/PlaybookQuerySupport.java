package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookPage;
import org.team4u.actiondock.domain.model.PlaybookQuery;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * 测试用任务手册查询支持工具，提供内存中的条件下推与分页实现，
 * 供各 InMemoryPlaybookRepository 复用，语义与 JpaPlaybookRepositoryAdapter 保持一致。
 */
final class PlaybookQuerySupport {

    private PlaybookQuerySupport() {
    }

    static List<Playbook> filterByQuery(Collection<Playbook> all, PlaybookQuery query) {
        String normalizedTag = query == null || query.tag() == null || query.tag().isBlank()
                ? null : query.tag().trim().toLowerCase(Locale.ROOT);
        return all.stream()
                .filter(p -> query == null || query.enabled() == null || query.enabled() == p.isEnabled())
                .filter(p -> query == null || query.managed() == null || query.managed() == p.isManaged())
                .filter(p -> query == null || query.repositoryId() == null
                        || p.getRepositoryIds().isEmpty()
                        || p.getRepositoryIds().contains(query.repositoryId()))
                .filter(p -> normalizedTag == null
                        || p.getTags().stream().map(t -> t.toLowerCase(Locale.ROOT)).anyMatch(normalizedTag::equals))
                .toList();
    }

    static List<Playbook> findByQuery(Collection<Playbook> all, PlaybookQuery query) {
        List<Playbook> filtered = filterByQuery(all, query);
        if (query != null && query.isPaged()) {
            int from = Math.min(query.pageIndex() * query.pageSize(), filtered.size());
            int to = Math.min(from + query.pageSize(), filtered.size());
            return new ArrayList<>(filtered.subList(from, to));
        }
        return filtered;
    }

    static PlaybookPage pageOf(Collection<Playbook> all, PlaybookQuery query) {
        List<Playbook> filtered = filterByQuery(all, query);
        int pageSize = query == null || query.pageSize() <= 0 ? filtered.size() : query.pageSize();
        int pageIndex = query == null ? 0 : query.pageIndex();
        int from = Math.min(pageIndex * pageSize, filtered.size());
        int to = Math.min(from + pageSize, filtered.size());
        List<Playbook> pageItems = new ArrayList<>(filtered.subList(from, to));
        int totalPages = pageSize == 0 ? 1 : (int) Math.ceil((double) filtered.size() / pageSize);
        return new PlaybookPage(pageItems, pageIndex, pageSize, filtered.size(), totalPages);
    }

    static List<Playbook> referencing(Collection<Playbook> all, String playbookId) {
        if (playbookId == null || playbookId.isBlank()) {
            return List.of();
        }
        return all.stream()
                .filter(p -> !p.getId().equals(playbookId))
                .filter(p -> p.getRelatedPlaybookRefs().stream()
                        .anyMatch(ref -> playbookId.equals(ref.getPlaybookId())))
                .toList();
    }
}
