package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

/**
 * AI 工具集仓储接口，提供工具集配置的持久化和查询能力。
 * <p>
 * 工具集是工具的逻辑分组，每个工具集可包含多个工具提供者。
 * Agent 配置通过关联工具集来确定可使用的工具范围。
 *
 * @author jay.wu
 */
public interface AiToolsetRepository {

    /**
     * 保存工具集配置。
     *
     * @param toolset 工具集配置
     * @return 保存后的工具集配置
     */
    AiToolset save(AiToolset toolset);

    /**
     * 根据 ID 查找工具集配置。
     *
     * @param id 工具集 ID
     * @return 工具集配置，不存在时返回空
     */
    Optional<AiToolset> findById(String id);

    /**
     * 查询所有工具集配置。
     *
     * @return 工具集配置列表
     */
    List<AiToolset> findAll();

    /**
     * 根据 ID 删除工具集配置。
     *
     * @param id 工具集 ID
     */
    void deleteById(String id);
}
