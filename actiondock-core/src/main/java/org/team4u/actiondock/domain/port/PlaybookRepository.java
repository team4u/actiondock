package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookPage;
import org.team4u.actiondock.domain.model.PlaybookQuery;

import java.util.List;
import java.util.Optional;

public interface PlaybookRepository {
    Playbook save(Playbook playbook);

    Optional<Playbook> findById(String id);

    List<Playbook> findAll();

    /**
     * 按条件查询任务手册，支持可选分页。
     * <p>
     * 当 {@link PlaybookQuery#isPaged()} 为 true 时返回分页结果，否则返回全部匹配记录。
     *
     * @param query 查询条件（不可为 null）
     * @return 匹配的任务手册列表（已按 page/size 截断）
     */
    List<Playbook> findByQuery(PlaybookQuery query);

    /**
     * 按条件查询任务手册的分页结果，包含总记录数与总页数。
     *
     * @param query 查询条件（不可为 null）
     * @return 分页结果
     */
    PlaybookPage findPage(PlaybookQuery query);

    /**
     * 查询所有在 relatedPlaybookRefs 中引用了指定任务手册的其他任务手册。
     * <p>
     * 用于删除前的引用完整性检查，避免全表内存扫描。
     *
     * @param playbookId 被引用的任务手册 ID（不可为 null）
     * @return 引用了该任务手册的其他任务手册列表
     */
    List<Playbook> findReferencingPlaybooks(String playbookId);

    void deleteById(String id);
}
