package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.common.NormalizeUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;

/**
 * 仓库索引文件操作工具类。
 *
 * <p>提供索引文件的列表替换（with*）和条目更新（upsertSorted）等静态方法，
 * 从 {@link RepositoryCatalogTypes} 中提取以便独立维护。</p>
 *
 * @author jay.wu
 */
final class RepositoryIndexUtils {

    static final int DEFAULT_VERSION = 1;

    private RepositoryIndexUtils() {
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withScripts(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                                  RepositoryDefinition repository,
                                                                  List<RepositoryCatalogTypes.RepositoryIndexEntry> scripts) {
        return withReplaced(current, repository, scripts, null, null, null, null, null, null);
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withWebhooks(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                                       RepositoryDefinition repository,
                                                                       List<RepositoryCatalogTypes.RepositoryWebhookIndexEntry> webhooks) {
        return withReplaced(current, repository, null, webhooks, null, null, null, null, null);
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withPlugins(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                   RepositoryDefinition repository,
                                                   List<RepositoryCatalogTypes.RepositoryPluginIndexEntry> plugins) {
        return withReplaced(current, repository, null, null, plugins, null, null, null, null);
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withPackages(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                    RepositoryDefinition repository,
                                                    List<RepositoryCatalogTypes.CapabilityPackageIndexEntry> packages) {
        return withReplaced(current, repository, null, null, null, packages, null, null, null);
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withSkills(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                   RepositoryDefinition repository,
                                                   List<RepositoryCatalogTypes.RepositorySkillIndexEntry> skills) {
        return withReplaced(current, repository, null, null, null, null, skills, null, null);
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withKnowledge(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                                     RepositoryDefinition repository,
                                                                     List<RepositoryCatalogTypes.RepositoryKnowledgeIndexEntry> knowledge) {
        return withReplaced(current, repository, null, null, null, null, null, knowledge, null);
    }

    static RepositoryCatalogTypes.RepositoryIndexFile withPlaybooks(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                                    RepositoryDefinition repository,
                                                                    List<RepositoryCatalogTypes.RepositoryPlaybookIndexEntry> playbooks) {
        return withReplaced(current, repository, null, null, null, null, null, null, playbooks);
    }

    @SuppressWarnings("unchecked")
    private static <T extends Record> RepositoryCatalogTypes.RepositoryIndexFile withReplaced(RepositoryCatalogTypes.RepositoryIndexFile current,
                                                                        RepositoryDefinition repository,
                                                                        List<RepositoryCatalogTypes.RepositoryIndexEntry> scripts,
                                                                        List<RepositoryCatalogTypes.RepositoryWebhookIndexEntry> webhooks,
                                                                        List<RepositoryCatalogTypes.RepositoryPluginIndexEntry> plugins,
                                                                        List<RepositoryCatalogTypes.CapabilityPackageIndexEntry> packages,
                                                                        List<RepositoryCatalogTypes.RepositorySkillIndexEntry> skills,
                                                                        List<RepositoryCatalogTypes.RepositoryKnowledgeIndexEntry> knowledge,
                                                                        List<RepositoryCatalogTypes.RepositoryPlaybookIndexEntry> playbooks) {
        return new RepositoryCatalogTypes.RepositoryIndexFile(
                DEFAULT_VERSION,
                repository.getName(),
                NormalizeUtils.normalizeNullable(repository.getDescription()),
                scripts != null ? scripts : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.scripts())),
                webhooks != null ? webhooks : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.webhooks())),
                plugins != null ? plugins : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.plugins())),
                packages != null ? packages : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.packages())),
                skills != null ? skills : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.skills())),
                knowledge != null ? knowledge : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.safeKnowledge())),
                playbooks != null ? playbooks : new ArrayList<>(NormalizeUtils.nullSafeList(current == null ? null : current.safePlaybooks()))
        );
    }

    static <T> List<T> upsertSorted(List<T> entries, T newEntry, Function<T, String> idExtractor) {
        List<T> updated = new ArrayList<>(entries);
        updated.removeIf(item -> idExtractor.apply(item).equals(idExtractor.apply(newEntry)));
        updated.add(newEntry);
        updated.sort(Comparator.comparing(idExtractor));
        return updated;
    }
}
