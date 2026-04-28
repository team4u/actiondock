package org.team4u.actiondock.cli;

import java.nio.file.Path;
import java.util.Map;

/**
 * Final HTTP request shape produced by a CLI command.
 */
record CliRequest(
        String method,
        String path,
        Map<String, ?> query,
        String jsonBody,
        MultipartBody multipartBody,
        DownloadTarget downloadTarget
) {
    static CliRequest get(String path, Map<String, ?> query) {
        return new CliRequest("GET", path, query, null, null, null);
    }

    static CliRequest delete(String path, Map<String, ?> query) {
        return new CliRequest("DELETE", path, query, null, null, null);
    }

    static CliRequest postJson(String path, Map<String, ?> query, String body) {
        return new CliRequest("POST", path, query, body, null, null);
    }

    static CliRequest putJson(String path, Map<String, ?> query, String body) {
        return new CliRequest("PUT", path, query, body, null, null);
    }

    static CliRequest postMultipart(String path, Map<String, ?> query, String fieldName, Path file, byte[] content) {
        return new CliRequest("POST", path, query, null, new MultipartBody(fieldName, file, content), null);
    }

    static CliRequest download(String path, Map<String, ?> query, Path outputFile) {
        return new CliRequest("GET", path, query, null, null, new DownloadTarget(outputFile));
    }

    record MultipartBody(String fieldName, Path file, byte[] content) {
    }

    record DownloadTarget(Path outputFile) {
    }
}
