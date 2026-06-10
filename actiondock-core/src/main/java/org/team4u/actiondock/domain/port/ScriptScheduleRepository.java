package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ScriptSchedule;

import java.util.List;
import java.util.Optional;

/**
 * 脚本调度仓储端口，提供定时调度配置的持久化操作。
 *
 * @author jay.wu
 */
public interface ScriptScheduleRepository {

    /**
     * 保存调度配置。
     * <p>
     * 新增或更新脚本调度配置，包含 Cron 表达式、启用状态等信息。
     *
     * @param schedule 要保存的调度配置
     * @return 保存后的调度配置（含生成的 ID 和时间戳）
     */
    ScriptSchedule save(ScriptSchedule schedule);

    /**
     * 根据唯一标识查找调度配置。
     *
     * @param id 调度配置的唯一标识
     * @return 匹配的调度配置，不存在时返回空的 Optional
     */
    Optional<ScriptSchedule> findById(String id);

    /**
     * 查询全部调度配置。
     *
     * @return 所有调度配置列表
     */
    List<ScriptSchedule> findAll();

    /**
     * 根据脚本定义标识查询其所有调度配置。
     *
     * @param scriptId 脚本定义的唯一标识
     * @return 该脚本的所有调度配置列表
     */
    List<ScriptSchedule> findByScriptId(String scriptId);

    /**
     * 查询所有已启用的调度配置。
     * <p>
     * 调度引擎使用此方法获取待执行的调度任务列表。
     *
     * @return 所有启用状态的调度配置列表
     */
    List<ScriptSchedule> findEnabled();

    /**
     * 根据唯一标识删除调度配置。
     *
     * @param id 要删除的调度配置唯一标识
     */
    void deleteById(String id);

    /**
     * 删除指定脚本定义的所有调度配置。
     * <p>
     * 通常在删除脚本定义时级联清理其关联的调度配置。
     *
     * @param scriptId 脚本定义的唯一标识
     */
    void deleteByScriptId(String scriptId);
}
