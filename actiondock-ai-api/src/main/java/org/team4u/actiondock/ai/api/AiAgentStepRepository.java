package org.team4u.actiondock.ai.api;

import java.util.List;

/**
 * Agent 执行步骤仓储接口，提供步骤记录的持久化和查询能力。
 * <p>
 * 每个 Agent 运行由多个步骤组成（如模型调用、工具执行），
 * 通过本接口存储和检索步骤详情，支持按运行 ID 过滤。
 *
 * @author jay.wu
 */
public interface AiAgentStepRepository {

    /**
     * 保存执行步骤记录。
     *
     * @param step 执行步骤
     * @return 保存后的步骤记录
     */
    AiAgentStep save(AiAgentStep step);

    /**
     * 根据运行 ID 查询所有执行步骤。
     *
     * @param runId 运行记录 ID
     * @return 执行步骤列表
     */
    List<AiAgentStep> findByRunId(String runId);

    /**
     * 根据运行 ID 删除所有关联的执行步骤。
     *
     * @param runId 运行记录 ID
     */
    void deleteByRunId(String runId);
}
