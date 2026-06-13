package org.team4u.actiondock.domain.model;

/**
 * 任务手册查询条件。
 * <p>
 * 用于 {@code PlaybookRepository} 的条件下推查询。所有过滤字段均可为 {@code null}，
 * 表示不施加该过滤条件。{@code page} 与 {@code size} 同时为 {@code null} 时表示不分页，
 * 返回全部匹配记录；二者同时非 {@code null} 时启用分页。
 *
 * @author jay.wu
 */
public record PlaybookQuery(
        String repositoryId,
        String tag,
        Boolean enabled,
        Boolean managed,
        Integer page,
        Integer size
) {
    /**
     * 是否启用分页。
     *
     * @return 当 page 与 size 均非 null 时返回 true
     */
    public boolean isPaged() {
        return page != null && size != null;
    }

    /**
     * 返回从 0 开始的页码，未指定分页时默认为 0。
     *
     * @return 页码
     */
    public int pageIndex() {
        return page == null ? 0 : Math.max(0, page);
    }

    /**
     * 返回每页大小，未指定分页时默认为 0。
     *
     * @return 每页大小
     */
    public int pageSize() {
        return size == null || size <= 0 ? 0 : size;
    }

    /**
     * 基于当前过滤条件构造一个不分页的查询（保留 repositoryId/tag/enabled/managed）。
     *
     * @return 不分页的查询条件
     */
    public PlaybookQuery withoutPaging() {
        return new PlaybookQuery(repositoryId, tag, enabled, managed, null, null);
    }
}
