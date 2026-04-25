package org.team4u.actiondock.repository;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.regex.Pattern;

public class LocalPluginArtifactResolver implements PluginArtifactResolver {
    private static final Pattern WINDOWS_ABSOLUTE_PATH = Pattern.compile("^[A-Za-z]:[\\\\/].*");

    @Override
    public Set<String> supportedSchemes() {
        return Set.of("local");
    }

    @Override
    public PluginArtifact resolve(PluginArtifactRef artifact, PluginArtifactContext context) {
        if ("HTTP".equals(context.repository().getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持 local:// 插件制品");
        }
        URI uri = URI.create(artifact.uri());
        String relativePath = uri.getSchemeSpecificPart();
        if (relativePath != null && relativePath.startsWith("//")) {
            relativePath = relativePath.substring(2);
        }
        validateRelativePath(relativePath);

        Path repositoryRoot = context.repositoryRoot().toAbsolutePath().normalize();
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

    private void validateRelativePath(String path) {
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("local artifact 路径不能为空");
        }
        if (path.contains("..")) {
            throw new IllegalArgumentException("local artifact 不允许包含 ..");
        }
        if (WINDOWS_ABSOLUTE_PATH.matcher(path).matches()) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
        Path parsed = Path.of(path);
        if (parsed.isAbsolute()) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
    }

    private String resolveFileName(PluginArtifactRef artifact, Path path) {
        if (artifact.fileName() != null && !artifact.fileName().isBlank()) {
            return artifact.fileName();
        }
        return path.getFileName().toString();
    }
}
