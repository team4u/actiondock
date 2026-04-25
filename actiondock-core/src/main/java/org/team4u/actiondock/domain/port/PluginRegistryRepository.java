package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.PluginRegistration;

import java.util.List;
import java.util.Optional;

/**
 * 插件注册仓储端口，管理插件的注册信息持久化。
 *
 * @author jay.wu
 */
public interface PluginRegistryRepository {

    /**
     * 保存插件注册信息。
     * <p>
     * 注册新插件或更新已有插件的注册信息，包括插件标识、名称、启用状态等。
     *
     * @param registration 要保存的插件注册信息
     * @return 保存后的插件注册信息
     */
    PluginRegistration save(PluginRegistration registration);

    /**
     * 根据插件标识查找注册信息。
     *
     * @param pluginId 插件的唯一标识
     * @return 匹配的插件注册信息，不存在时返回空的 Optional
     */
    Optional<PluginRegistration> findByPluginId(String pluginId);

    /**
     * 查询全部已注册的插件。
     *
     * @return 所有插件注册信息列表
     */
    List<PluginRegistration> findAll();

    /**
     * 查询所有已启用的插件注册信息。
     * <p>
     * 系统启动或热加载时使用此方法获取可用的插件列表。
     *
     * @return 所有启用状态的插件注册信息列表
     */
    List<PluginRegistration> findEnabled();

    /**
     * 根据插件标识删除注册信息。
     * <p>
     * 卸载插件时调用，同时清理该插件的注册记录。
     *
     * @param pluginId 要删除的插件唯一标识
     */
    void deleteByPluginId(String pluginId);
}
