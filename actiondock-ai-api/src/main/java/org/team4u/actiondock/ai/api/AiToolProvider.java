package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

/**
 * AI 工具提供者接口，由具体的工具来源实现。
 * <p>
 * 每个提供者代表一类工具来源（如静态内置工具、脚本动态工具），
 * 工具注册表通过聚合多个提供者来构建完整的工具集。
 *
 * @author jay.wu
 */
public interface AiToolProvider {

    /**
     * 列出此提供者提供的所有工具。
     *
     * @return 工具列表
     */
    List<AiTool> listTools();

    /**
     * 根据名称查找工具。
     *
     * @param name 工具名称
     * @return 工具定义，不存在时返回空
     */
    Optional<AiTool> findTool(String name);
}
