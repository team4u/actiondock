package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

/**
 * Agent 配置仓储接口，提供 Agent 配置的持久化和查询能力。
 * <p>
 * 管理 Agent 的行为参数（如系统提示词、最大迭代次数、关联工具集），
 * 供 {@link AiAgentRuntime} 在运行时加载使用。
 *
 * @author jay.wu
 */
public interface AiAgentProfileRepository {

    /**
     * 保存 Agent 配置。
     *
     * @param profile Agent 配置
     * @return 保存后的 Agent 配置
     */
    AiAgentProfile save(AiAgentProfile profile);

    /**
     * 根据 ID 查找 Agent 配置。
     *
     * @param id Agent 配置 ID
     * @return Agent 配置，不存在时返回空
     */
    Optional<AiAgentProfile> findById(String id);

    /**
     * 查询所有 Agent 配置。
     *
     * @return Agent 配置列表
     */
    List<AiAgentProfile> findAll();

    /**
     * 根据 ID 删除 Agent 配置。
     *
     * @param id Agent 配置 ID
     */
    void deleteById(String id);
}
