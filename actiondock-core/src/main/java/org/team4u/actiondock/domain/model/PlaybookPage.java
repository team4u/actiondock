package org.team4u.actiondock.domain.model;

import java.util.List;

/**
 * 任务手册分页结果。
 *
 * @param items         当前页数据
 * @param page          当前页码（从 0 开始）
 * @param size          每页大小
 * @param totalElements 满足过滤条件的记录总数
 * @param totalPages     总页数
 * @author jay.wu
 */
public record PlaybookPage(
        List<Playbook> items,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
}
