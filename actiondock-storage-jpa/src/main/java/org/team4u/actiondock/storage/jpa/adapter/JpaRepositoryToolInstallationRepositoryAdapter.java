package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryToolInstallationEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryToolInstallationRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 仓库工具安装仓储适配器，将领域层 RepositoryToolInstallationRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
@Component
public class JpaRepositoryToolInstallationRepositoryAdapter implements RepositoryToolInstallationRepository {
    private final SpringDataRepositoryToolInstallationRepository repository;

    public JpaRepositoryToolInstallationRepositoryAdapter(SpringDataRepositoryToolInstallationRepository repository) {
        this.repository = repository;
    }

    @Override
    public RepositoryToolInstallation save(RepositoryToolInstallation installation) {
        return toDomain(repository.save(toEntity(installation)));
    }

    @Override
    public Optional<RepositoryToolInstallation> findByToolId(String toolId) {
        return repository.findById(toolId).map(JpaRepositoryToolInstallationRepositoryAdapter::toDomain);
    }

    @Override
    public List<RepositoryToolInstallation> findAll() {
        return repository.findAll().stream().map(JpaRepositoryToolInstallationRepositoryAdapter::toDomain).toList();
    }

    @Override
    public void deleteByToolId(String toolId) {
        repository.deleteById(toolId);
    }

    /**
     * 将仓库工具安装领域对象转换为 JPA 实体。
     *
     * @param installation 仓库工具安装领域对象
     * @return JPA 实体
     */
    private static RepositoryToolInstallationEntity toEntity(RepositoryToolInstallation installation) {
        RepositoryToolInstallationEntity entity = new RepositoryToolInstallationEntity();
        entity.setToolId(installation.getToolId());
        entity.setRepositoryId(installation.getRepositoryId());
        entity.setName(installation.getName());
        entity.setVersionValue(installation.getVersion());
        entity.setLatestVersion(installation.getLatestVersion());
        entity.setOwner(installation.getOwner());
        entity.setDescription(installation.getDescription());
        entity.setInstalledAt(installation.getInstalledAt());
        entity.setUpdatedAt(installation.getUpdatedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为仓库工具安装领域对象。
     *
     * @param entity JPA 实体
     * @return 仓库工具安装领域对象
     */
    private static RepositoryToolInstallation toDomain(RepositoryToolInstallationEntity entity) {
        return new RepositoryToolInstallation()
                .setToolId(entity.getToolId())
                .setRepositoryId(entity.getRepositoryId())
                .setName(entity.getName())
                .setVersion(entity.getVersionValue())
                .setLatestVersion(entity.getLatestVersion())
                .setOwner(entity.getOwner())
                .setDescription(entity.getDescription())
                .setInstalledAt(entity.getInstalledAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
