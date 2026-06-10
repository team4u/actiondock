package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ExecutionRecord;

import java.util.List;
import java.util.Optional;

/**
 * 执行记录仓储端口，提供执行记录的持久化操作。
 *
 * @author jay.wu
 */
public interface ExecutionRepository {

    /**
     * 保存执行记录。
     * <p>
     * 持久化脚本执行的完整生命周期记录，包括输入参数、输出结果、执行状态和耗时等。
     *
     * @param record 要保存的执行记录
     * @return 保存后的执行记录（含生成的 ID 和时间戳）
     */
    ExecutionRecord save(ExecutionRecord record);

    /**
     * 根据唯一标识查找执行记录。
     *
     * @param id 执行记录的唯一标识
     * @return 匹配的执行记录，不存在时返回空的 Optional
     */
    Optional<ExecutionRecord> findById(String id);

    /**
     * 根据脚本定义标识查询其所有执行记录。
     * <p>
     * 返回结果按时间倒序排列，最新的执行记录排在前面。
     *
     * @param scriptId 脚本定义的唯一标识
     * @return 该脚本的所有执行记录列表
     */
    List<ExecutionRecord> findByScriptId(String scriptId);

    /**
     * 查询全部执行记录。
     *
     * @return 所有执行记录列表
     */
    List<ExecutionRecord> findAll();

    /**
     * 根据唯一标识删除执行记录。
     *
     * @param id 要删除的执行记录唯一标识
     */
    void deleteById(String id);

    /**
     * 根据调度标识查询其所有执行记录。
     * <p>
     * 返回结果按时间倒序排列，最新的执行记录排在前面。
     *
     * @param scheduleId 调度标识
     * @return 该调度关联的所有执行记录列表
     */
    List<ExecutionRecord> findByScheduleId(String scheduleId);

    /**
     * 删除指定脚本定义的所有执行记录。
     * <p>
     * 通常在删除脚本定义时级联清理其历史执行数据。
     *
     * @param scriptId 脚本定义的唯一标识
     */
    void deleteByScriptId(String scriptId);

    /**
     * 保留最新指定数量的执行记录，删除超出部分的较旧记录。
     *
     * @param scriptId 脚本 ID
     * @param limit    要保留的最新记录数
     */
    void keepLatest(String scriptId, int limit);
}
