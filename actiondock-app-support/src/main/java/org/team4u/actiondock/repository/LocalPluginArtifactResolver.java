package org.team4u.actiondock.repository;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.LOCAL_ARTIFACT_SCHEME;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.REPO_TYPE_HTTP;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.WINDOWS_ABSOLUTE_PATH_REGEX;
import org.team4u.actiondock.shared.NormalizeUtils;


import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.regex.Pattern;

public class LocalPluginArtifactResolver implements PluginArtifactResolver {
    private static final Pattern WINDOWS_ABSOLUTE_PATH = Pattern.compile(WINDOWS_ABSOLUTE_PATH_REGEX);

    @Override
    public Set<String> supportedSchemes() {
        return Set.of(LOCAL_ARTIFACT_SCHEME);
    }

    @Override
    public PluginArtifact resolve(PluginArtifactRef artifact, PluginArtifactContext context) {
        if (REPO_TYPE_HTTP.equals(context.repository().getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持 local:// 插件制品");
        }
        URI uri = URI.create(artifact.uri());
        String relativePath = uri.getSchemeSpecificPart();
        if (relativePath != null && relativePath.startsWith("//")) {
            relativePath = relativePath.substring(2);
        }
        validateRelativePath(relativePath);

        Path repositoryRoot = NormalizeUtils.normalizePath(context.repositoryRoot());
        Path artifactPath = repositoryRoot.resolve(relativePath).normalize();
        if (!artifactPath.startsWith(repositoryRoot)) {
            throw new IllegalArgumentException("local artifact 越界访问被拒绝");
        }

        try {
            Path realRepositoryRoot = repositoryRoot.toRealPath();
            Path realArtifactPath = artifactPath.toRealPath();
            if (!realArtifactPath.startsWith(realRepositoryRoot)) {
                throw new IllegalArgumentException("local artifact 越界访问被拒绝");
            }
            return new PluginArtifact(resolveFileName(artifact, realArtifactPath), Files.readAllBytes(realArtifactPath));
        } catch (IOException exception) {
            throw new IllegalStateException("读取本地插件 JAR 失败: " + artifact.uri(), exception);
        }
    }

    private static void validateRelativePath(String path) {
        RepositoryVersionUtils.validateRelativePath(path, "local artifact");
        if (WINDOWS_ABSOLUTE_PATH.matcher(path).matches()) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
    }

    private static String resolveFileName(PluginArtifactRef artifact, Path path) {
        if (NormalizeUtils.isNotBlank(artifact.fileName())) {
            return artifact.fileName();
        }
        return path.getFileName().toString();
    }
}
