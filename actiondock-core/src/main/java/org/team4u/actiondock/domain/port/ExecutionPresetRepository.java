package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ExecutionPreset;

import java.util.List;
import java.util.Optional;

/**
 * 执行参数预设备储端口，提供预设的持久化操作。
 *
 * @author jay.wu
 */
public interface ExecutionPresetRepository {

    /**
     * 保存参数预设。
     *
     * @param preset 要保存的预设
     * @return 保存后的预设（含生成的 ID 和时间戳）
     */
    ExecutionPreset save(ExecutionPreset preset);

    /**
     * 根据唯一标识查找参数预设。
     *
     * @param id 预设的唯一标识
     * @return 匹配的预设，不存在时返回空的 Optional
     */
    Optional<ExecutionPreset> findById(String id);

    /**
     * 根据脚本定义标识查询其所有参数预设。
     *
     * @param scriptId 脚本定义的唯一标识
     * @return 该脚本的所有参数预设列表
     */
    List<ExecutionPreset> findByScriptId(String scriptId);

    /**
     * 根据唯一标识删除参数预设。
     *
     * @param id 要删除的预设唯一标识
     */
    void deleteById(String id);

    /**
     * 删除指定脚本定义的所有参数预设。
     *
     * @param scriptId 脚本定义的唯一标识
     */
    void deleteByScriptId(String scriptId);
}
