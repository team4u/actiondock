package org.team4u.actiondock.ai.api;

import java.util.List;

/**
 * AI 调用日志仓储接口，提供调用记录的持久化能力。
 * <p>
 * 记录每次 AI 模型调用的请求参数、响应结果和耗时等信息，
 * 用于审计追踪和调用分析。
 *
 * @author jay.wu
 */
public interface AiCallLogRepository {

    /**
     * 保存调用日志记录。
     *
     * @param log 调用日志
     * @return 保存后的日志记录
     */
    AiCallLog save(AiCallLog log);

    /**
     * 查询所有调用日志记录。
     *
     * @return 调用日志列表
     */
    List<AiCallLog> findAll();
}
