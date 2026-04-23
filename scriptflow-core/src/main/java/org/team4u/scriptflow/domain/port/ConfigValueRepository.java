package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ConfigValue;

import java.util.List;
import java.util.Optional;

/**
 * 全局配置值仓储端口。
 *
 * @author jay.wu
 */
public interface ConfigValueRepository {
    ConfigValue save(ConfigValue configValue);

    Optional<ConfigValue> findByKey(String key);

    List<ConfigValue> findAll();

    void deleteByKey(String key);
}
