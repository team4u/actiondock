package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

/**
 * Agent 运行记录仓储接口，提供运行记录的持久化和查询能力。
 * <p>
 * 存储每次 Agent 运行的状态、输入输出和执行结果，
 * 支持按 ID 查询、全量查询和删除操作。
 *
 * @author jay.wu
 */
public interface AiAgentRunRepository {

    /**
     * 保存 Agent 运行记录。
     *
     * @param run 运行记录
     * @return 保存后的运行记录
     */
    AiAgentRunRecord save(AiAgentRunRecord run);

    /**
     * 根据 ID 查找运行记录。
     *
     * @param id 运行记录 ID
     * @return 运行记录，不存在时返回空
     */
    Optional<AiAgentRunRecord> findById(String id);

    /**
     * 查询所有运行记录。
     *
     * @return 运行记录列表
     */
    List<AiAgentRunRecord> findAll();

    /**
     * 根据 ID 删除运行记录。
     *
     * @param id 运行记录 ID
     */
    void deleteById(String id);
}
