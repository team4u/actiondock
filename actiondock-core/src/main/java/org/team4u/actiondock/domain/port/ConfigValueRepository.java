package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ConfigValue;

import java.util.List;
import java.util.Optional;

/**
 * 全局配置值仓储端口。
 *
 * @author jay.wu
 */
public interface ConfigValueRepository {

    /**
     * 保存配置值。
     * <p>
     * 新增或更新全局配置项，以 key-value 形式存储。
     *
     * @param configValue 要保存的配置值
     * @return 保存后的配置值
     */
    ConfigValue save(ConfigValue configValue);

    /**
     * 根据配置键查找配置值。
     *
     * @param key 配置项的唯一键名
     * @return 匹配的配置值，不存在时返回空的 Optional
     */
    Optional<ConfigValue> findByKey(String key);

    /**
     * 查询全部配置值。
     *
     * @return 所有配置值列表
     */
    List<ConfigValue> findAll();

    /**
     * 根据配置键删除配置值。
     *
     * @param key 要删除的配置项键名
     */
    void deleteByKey(String key);
}
