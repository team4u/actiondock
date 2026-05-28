package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.RepositoryPluginConflict;
import org.team4u.actiondock.domain.exception.RepositoryPluginConflictException;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginView;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.common.NormalizeUtils;

import java.util.List;
import java.util.Optional;

/**
 * 仓库插件安装、更新和版本校验服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责插件从仓库的安装、升级，
 * 以及插件依赖解析、版本兼容性校验、完整性校验等职责。
 *
 * @author jay.wu
 */
public class RepositoryPluginService {

    private final RepositoryCatalogService catalog;
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptRepository scriptRepository;
    private final PluginArtifactResolverRegistry pluginArtifactResolverRegistry;

    public RepositoryPluginService(RepositoryCatalogService catalog,
                                   PluginRuntimeService pluginRuntimeService,
                                   ScriptRepository scriptRepository,
                                   PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        this.catalog = catalog;
        this.pluginRuntimeService = pluginRuntimeService;
        this.scriptRepository = scriptRepository;
        this.pluginArtifactResolverRegistry = pluginArtifactResolverRegistry;
    }

    /**
     * 从指定仓库安装插件。
     *
     * @param repositoryId 仓库 ID
     * @param pluginId     插件 ID
     * @param force        是否强制安装（忽略版本冲突）
     * @return 安装结果，包含插件信息和冲突列表
     */
    public RepositoryPluginInstallResult installPlugin(String repositoryId, String pluginId, boolean force) {
        return installOrUpdatePlugin(repositoryId, pluginId, false, force);
    }

    /**
     * 从指定仓库更新插件。
     *
     * @param repositoryId 仓库 ID
     * @param pluginId     插件 ID
     * @param force        是否强制更新（忽略版本冲突）
     * @return 更新结果，包含插件信息和冲突列表
     */
    public RepositoryPluginInstallResult updatePlugin(String repositoryId, String pluginId, boolean force) {
        return installOrUpdatePlugin(repositoryId, pluginId, true, force);
    }

    /**
     * 解析并安装/升级插件依赖。
     * <p>
     * 遍历依赖列表，检查本地是否已安装且版本满足要求；
     * 若不满足且允许自动安装，则从仓库安装或升级对应插件。
     *
     * @param repositoryId            仓库 ID
     * @param dependencies            插件依赖列表
     * @param installPluginDependencies 是否自动安装缺失的插件依赖
     * @param forcePluginUpgrade      是否强制升级插件
     */
    void resolvePluginDependencies(String repositoryId,
                                   List<PluginDependency> dependencies,
                                   boolean installPluginDependencies,
                                   boolean forcePluginUpgrade) {
        for (PluginDependency dependency : NormalizeUtils.nullSafeList(dependencies)) {
            String pluginId = NormalizeUtils.normalize(dependency.getPluginId(), "插件依赖 pluginId 不能为空");
            PluginRegistration registration = pluginRuntimeService.findPluginRegistration(pluginId).orElse(null);
            if (registration != null && RepositoryVersionUtils.versionSatisfies(registration.getVersion(), dependency.getVersionRange())) {
                continue;
            }
            assertDependencySatisfiable(pluginId, dependency, installPluginDependencies);
            assertRepositoryVersionSatisfies(repositoryId, pluginId, dependency);
            installOrUpdate(repositoryId, pluginId, registration == null, forcePluginUpgrade);
        }
    }

    private void assertDependencySatisfiable(String pluginId, PluginDependency dependency, boolean installPluginDependencies) {
        if (!installPluginDependencies) {
            throw new IllegalArgumentException("缺少插件依赖或版本不满足: " + pluginId + " " + NormalizeUtils.normalizeOrDefault(dependency.getVersionRange(), ""));
        }
    }

    private void assertRepositoryVersionSatisfies(String repositoryId, String pluginId, PluginDependency dependency) {
        RepositoryPluginDescriptor descriptor = findRepositoryPlugin(repositoryId, pluginId)
                .orElseThrow(() -> new IllegalArgumentException("仓库中缺少插件依赖: " + pluginId));
        if (!RepositoryVersionUtils.versionSatisfies(descriptor.version(), dependency.getVersionRange())) {
            throw new IllegalArgumentException("仓库插件版本不满足工具依赖: " + pluginId + " " + dependency.getVersionRange());
        }
    }

    private void installOrUpdate(String repositoryId, String pluginId, boolean freshInstall, boolean force) {
        if (freshInstall) {
            installPlugin(repositoryId, pluginId, force);
        } else {
            updatePlugin(repositoryId, pluginId, force);
        }
    }

    private RepositoryPluginInstallResult installOrUpdatePlugin(String repositoryId,
                                                                                         String pluginId,
                                                                                         boolean updateOnly,
                                                                                         boolean force) {
        RepositoryPluginDetail detail = catalog.getRepositoryPlugin(repositoryId, pluginId);
        RepositoryPluginDescriptor descriptor = detail.descriptor();
        PluginRegistration existing = pluginRuntimeService.findPluginRegistration(pluginId).orElse(null);
        if (updateOnly && existing == null) {
            throw new IllegalArgumentException("插件尚未安装: " + pluginId);
        }
        List<RepositoryPluginConflict> conflicts = findPluginConflicts(pluginId, descriptor.version());
        if (!conflicts.isEmpty() && !force) {
            throw new RepositoryPluginConflictException(pluginId, conflicts);
        }

        PluginArtifact artifact = resolvePluginArtifact(detail, repositoryId);
        PluginView plugin = installOrUpgradePlugin(existing, artifact, repositoryId, pluginId, descriptor.version());
        return new RepositoryPluginInstallResult(plugin, conflicts);
    }

    private PluginArtifact resolvePluginArtifact(RepositoryPluginDetail detail, String repositoryId) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        PluginArtifactRef artifactRef = catalog.validatePluginArtifactRef(detail.plugin().artifact(), true);
        PluginArtifact artifact = pluginArtifactResolverRegistry.resolve(
                artifactRef,
                new PluginArtifactContext(repository, detail, catalog.resolveRepositoryRoot(repository))
        );
        RepositoryVersionUtils.verifySha256(detail.descriptor().pluginId(), artifact.content(), artifactRef.sha256());
        RepositoryVersionUtils.verifySize(detail.descriptor().pluginId(), artifact.content(), artifactRef.size());
        return artifact;
    }

    private PluginView installOrUpgradePlugin(PluginRegistration existing,
                                              PluginArtifact artifact,
                                              String repositoryId,
                                              String pluginId,
                                              String version) {
        return existing == null
                ? pluginRuntimeService.installFromRepository(artifact.fileName(), artifact.content(), repositoryId, pluginId, version)
                : pluginRuntimeService.upgradeFromRepository(pluginId, artifact.fileName(), artifact.content(), repositoryId, pluginId, version);
    }

    private Optional<RepositoryPluginDescriptor> findRepositoryPlugin(String repositoryId, String pluginId) {
        return catalog.listRepositoryPlugins(repositoryId).stream()
                .filter(item -> pluginId.equals(item.pluginId()))
                .findFirst();
    }

    private List<RepositoryPluginConflict> findPluginConflicts(String pluginId, String targetVersion) {
        return scriptRepository.findAll().stream()
                .flatMap(script -> script.getPluginDependencies().stream()
                        .filter(dep -> pluginId.equals(dep.getPluginId()) && !RepositoryVersionUtils.versionSatisfies(targetVersion, dep.getVersionRange()))
                        .map(dep -> new RepositoryPluginConflict(script.getId(), script.getName(), dep.getVersionRange())))
                .toList();
    }
}
