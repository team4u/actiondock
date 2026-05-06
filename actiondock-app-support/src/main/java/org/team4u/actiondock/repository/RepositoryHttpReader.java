package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

class RepositoryHttpReader {

    private final HttpClient httpClient;
    private final JsonCodec jsonCodec;

    RepositoryHttpReader(HttpClient httpClient, JsonCodec jsonCodec) {
        this.httpClient = httpClient;
        this.jsonCodec = jsonCodec;
    }

    <T> T readHttpJson(String url, Class<T> type) {
        String text = readHttpText(url);
        RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(text, type, url);
        return jsonCodec.read(text, type);
    }

    String readHttpText(String url) {
        return executeHttpGet(url, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private <T> T executeHttpGet(String url, HttpResponse.BodyHandler<T> bodyHandler) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
        try {
            HttpResponse<T> response = httpClient.send(request, bodyHandler);
            if (response.statusCode() >= 400) {
                throw new IllegalArgumentException("HTTP 仓库访问失败: " + response.statusCode());
            }
            return response.body();
        } catch (IOException | InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("访问 HTTP 仓库失败: " + url, exception);
        }
    }

    static String joinHttpPath(String baseUrl, String relativePath) {
        String normalizedBase = NormalizeUtils.normalize(baseUrl, "仓库地址不能为空");
        while (normalizedBase.endsWith("/")) {
            normalizedBase = normalizedBase.substring(0, normalizedBase.length() - 1);
        }
        RepositoryVersionUtils.validateRelativePath(relativePath, "仓库文件路径");
        String normalizedRelative = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
        return normalizedBase + "/" + normalizedRelative;
    }
}
