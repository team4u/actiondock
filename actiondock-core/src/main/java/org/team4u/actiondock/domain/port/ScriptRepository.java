package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptScope;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * 脚本定义仓储端口，提供脚本定义的持久化操作。
 *
 * @author jay.wu
 */
public interface ScriptRepository {

    /**
     * 保存脚本定义。
     * <p>
     * 新增或更新脚本定义，持久化其名称、类型、源代码、输入输出模式等全部属性。
     *
     * @param definition 要保存的脚本定义
     * @return 保存后的脚本定义（含生成的 ID 和时间戳）
     */
    ScriptDefinition save(ScriptDefinition definition);

    /**
     * 根据唯一标识查找脚本定义。
     *
     * @param id 脚本定义的唯一标识
     * @return 匹配的脚本定义，不存在时返回空的 Optional
     */
    Optional<ScriptDefinition> findById(String id);

    /**
     * 根据来源仓库与仓库脚本标识查找已安装的仓库脚本。
     *
     * @param repositoryId 来源仓库 ID
     * @param repositoryScriptId 来源仓库脚本 ID
     * @return 匹配的已安装脚本，不存在时返回空的 Optional
     */
    default Optional<ScriptDefinition> findInstalledByRepositorySource(String repositoryId, String repositoryScriptId) {
        return findAll().stream()
                .filter(item -> item.getScope() == ScriptScope.REPOSITORY)
                .filter(item -> Objects.equals(repositoryId, item.getRepositoryId()))
                .filter(item -> Objects.equals(repositoryScriptId, item.getRepositoryScriptId()))
                .findFirst();
    }

    /**
     * 查询全部脚本定义。
     *
     * @return 所有脚本定义列表，无数据时返回空列表
     */
    List<ScriptDefinition> findAll();

    /**
     * 根据唯一标识删除脚本定义。
     *
     * @param id 要删除的脚本定义唯一标识
     */
    void deleteById(String id);
}
