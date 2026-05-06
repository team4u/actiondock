package org.team4u.actiondock.repository;

import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;

public class HttpPluginArtifactResolver implements PluginArtifactResolver {
    private final HttpClient httpClient;

    public HttpPluginArtifactResolver() {
        this(HttpClient.newHttpClient());
    }

    HttpPluginArtifactResolver(HttpClient httpClient) {
        this.httpClient = httpClient;
    }

    @Override
    public Set<String> supportedSchemes() {
        return Set.of("http", "https");
    }

    @Override
    public PluginArtifact resolve(PluginArtifactRef artifact, PluginArtifactContext context) {
        URI uri = URI.create(artifact.uri());
        HttpRequest request = HttpRequest.newBuilder(uri)
                .GET()
                .timeout(Duration.ofSeconds(60))
                .build();
        try {
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("插件下载失败，HTTP 状态码: " + response.statusCode());
            }
            byte[] content = response.body();
            if (content == null || content.length == 0) {
                throw new IllegalStateException("插件下载结果为空");
            }
            return new PluginArtifact(resolveFileName(artifact, uri), content);
        } catch (IOException exception) {
            throw new IllegalStateException("下载插件失败: " + artifact.uri(), exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("下载插件被中断: " + artifact.uri(), exception);
        }
    }

    private static String resolveFileName(PluginArtifactRef artifact, URI uri) {
        if (NormalizeUtils.isNotBlank(artifact.fileName())) {
            return artifact.fileName();
        }
        Path fileName = Path.of(uri.getPath()).getFileName();
        return fileName == null ? "plugin.jar" : fileName.toString();
    }
}
