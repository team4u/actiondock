package org.team4u.actiondock.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Set;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

final class RepositoryWorkspaceHelper {

    private static final ObjectMapper METADATA_OBJECT_MAPPER = new ObjectMapper();
    private static final Set<Class<?>> METADATA_TYPES = Set.of(
            RepositoryCatalogTypes.RepositoryIndexFile.class,
            RepositoryCatalogTypes.ToolFile.class,
            RepositoryCatalogTypes.PluginFile.class,
            RepositoryCatalogTypes.SkillFile.class,
            RepositoryCatalogTypes.CapabilityPackageManifestFile.class,
            RepositoryCatalogTypes.CapabilityPackageReleaseFile.class,
            RepositoryCatalogTypes.KnowledgeFile.class
    );
    private RepositoryWorkspaceHelper() {
    }

    static void assertLatestRepositoryMetadata(String raw, Class<?> type, String source) {
        if (!METADATA_TYPES.contains(type)) {
            return;
        }
        JsonNode root;
        try {
            root = METADATA_OBJECT_MAPPER.readTree(raw);
        } catch (JsonProcessingException exception) {
            return;
        }
        if (root == null || !root.isObject()) {
            return;
        }
    }

    static void ensureRepositoryWorkspace(Path root, RepositoryDefinition repository, JsonCodec jsonCodec) {
        try {
            Files.createDirectories(root);
            for (String dir : REPO_INDEX_SECTIONS) {
                Files.createDirectories(root.resolve(dir));
            }
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("初始化仓库目录失败: " + root, exception);
        }
    }

    static RepositoryCatalogTypes.RepositoryIndexFile emptyRepositoryIndex(RepositoryDefinition repository) {
        String repositoryName = NormalizeUtils.normalizeNullable(repository == null ? null : repository.getName());
        String repositoryId = NormalizeUtils.normalizeNullable(repository == null ? null : repository.getId());
        return new RepositoryCatalogTypes.RepositoryIndexFile(
                1,
                repositoryName != null ? repositoryName : repositoryId,
                NormalizeUtils.normalizeNullable(repository == null ? null : repository.getDescription()),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>()
        );
    }
}
