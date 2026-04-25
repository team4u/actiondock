package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.RepositoryDefinition;

import java.util.List;
import java.util.Optional;

/**
 * 工具仓库定义仓储端口。
 *
 * @author jay.wu
 */
public interface RepositoryDefinitionRepository {
    RepositoryDefinition save(RepositoryDefinition registryDefinition);

    Optional<RepositoryDefinition> findById(String id);

    List<RepositoryDefinition> findAll();

    void deleteById(String id);
}
