package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.team4u.actiondock.storage.jpa.entity.PlaybookEntity;

import java.util.List;

public interface SpringDataPlaybookRepository extends JpaRepository<PlaybookEntity, String> {

    /**
     * 按 enabled/managed 直接列过滤，tags 与 repositoryIdsJson 以 LIKE 模糊匹配 JSON 数组内容。
     * <p>
     * 注意：tags 与 repositoryIds 均以 JSON 数组字符串存储（如 {@code ["a","b"]}），
     * 此处采用 {@code LIKE} 近似匹配元素，依赖入库时的标准化格式。当 enabled/managed 为 null 时不施加该条件。
     * <p>
     * repositoryId 过滤保留既有语义：当任务手册未关联任何仓库（repositoryIdsJson 为 null 或空数组 {@code []}）时，
     * 视为匹配任意 repositoryId。仅当 repositoryIdLike 非 null 时，匹配条件为
     * “未关联仓库 或 repositoryIdsJson 包含该 repositoryId”。
     *
     * @param enabled            启用标记，null 表示不过滤
     * @param managed            托管标记，null 表示不过滤
     * @param tagLike            标签 LIKE 模式，null 表示不过滤
     * @param repositoryIdLike   仓库 ID LIKE 模式，null 表示不过滤
     * @param pageable           分页参数
     * @return 匹配的任务手册实体分页
     */
    @Query(value = """
            select e from PlaybookEntity e
            where (:enabled is null or e.enabled = :enabled)
              and (:managed is null or e.managed = :managed)
              and (:tagLike is null or lower(cast(e.tagsJson as string)) like :tagLike)
              and (:repositoryIdLike is null
                    or e.repositoryIdsJson is null
                    or cast(e.repositoryIdsJson as string) = '[]'
                    or e.repositoryIdsJson like :repositoryIdLike)
            order by e.updatedAt desc, e.id asc
            """,
            countQuery = """
            select count(e) from PlaybookEntity e
            where (:enabled is null or e.enabled = :enabled)
              and (:managed is null or e.managed = :managed)
              and (:tagLike is null or lower(cast(e.tagsJson as string)) like :tagLike)
              and (:repositoryIdLike is null
                    or e.repositoryIdsJson is null
                    or cast(e.repositoryIdsJson as string) = '[]'
                    or e.repositoryIdsJson like :repositoryIdLike)
            """)
    Page<PlaybookEntity> findByConditions(@Param("enabled") Boolean enabled,
                                          @Param("managed") Boolean managed,
                                          @Param("tagLike") String tagLike,
                                          @Param("repositoryIdLike") String repositoryIdLike,
                                          Pageable pageable);

    /**
     * 查询 relatedPlaybookRefsJson 中引用了指定任务手册的所有实体。
     * <p>
     * relatedPlaybookRefs 以 JSON 数组存储（如 {@code [{"playbookId":"x"}]}），
     * 采用 {@code LIKE} 匹配 playbookId 元素。
     *
     * @param playbookIdLike playbookId 的 LIKE 模式
     * @return 引用了该 playbookId 的实体列表
     */
    @Query("""
            select e from PlaybookEntity e
            where e.relatedPlaybookRefsJson like :playbookIdLike
            order by e.id asc
            """)
    List<PlaybookEntity> findReferencingByPlaybookId(@Param("playbookIdLike") String playbookIdLike);
}
