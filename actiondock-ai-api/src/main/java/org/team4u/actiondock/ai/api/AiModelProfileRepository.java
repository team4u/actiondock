package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

/**
 * AI 模型配置仓储接口，提供模型配置的持久化和查询能力。
 * <p>
 * 管理不同 AI 模型的连接参数（如 API Key、端点地址、模型名称），
 * 供 {@link AiProviderClient} 在调用时引用。
 *
 * @author jay.wu
 */
public interface AiModelProfileRepository {

    /**
     * 保存模型配置。
     *
     * @param profile 模型配置
     * @return 保存后的模型配置
     */
    AiModelProfile save(AiModelProfile profile);

    /**
     * 根据 ID 查找模型配置。
     *
     * @param id 模型配置 ID
     * @return 模型配置，不存在时返回空
     */
    Optional<AiModelProfile> findById(String id);

    /**
     * 查询所有模型配置。
     *
     * @return 模型配置列表
     */
    List<AiModelProfile> findAll();

    /**
     * 根据 ID 删除模型配置。
     *
     * @param id 模型配置 ID
     */
    void deleteById(String id);
}
