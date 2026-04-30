package org.team4u.actiondock.desktop;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;

/**
 * Detects whether the configured local port already serves ActionDock.
 */
public class LocalServerProbe {
    private static final Duration TIMEOUT = Duration.ofMillis(600);

    private final HttpClient httpClient;

    public LocalServerProbe() {
        this(HttpClient.newBuilder()
                .connectTimeout(TIMEOUT)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build());
    }

    LocalServerProbe(HttpClient httpClient) {
        this.httpClient = httpClient;
    }

    public boolean isActionDockRunning(URI adminRootUri) {
        try {
            return healthIsUp(adminRootUri.resolve("/actuator/health")) && adminRedirectsToApp(adminRootUri);
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        }
    }

    private boolean healthIsUp(URI healthUri) throws IOException, InterruptedException {
        HttpResponse<String> response = send(healthUri);
        return response.statusCode() == 200 && response.body() != null && response.body().contains("\"UP\"");
    }

    private boolean adminRedirectsToApp(URI adminRootUri) throws IOException, InterruptedException {
        HttpResponse<String> response = send(adminRootUri);
        int status = response.statusCode();
        if (status == 200 && adminRootUri.getPath().startsWith("/admin")) {
            return true;
        }
        Optional<String> location = response.headers().firstValue("location");
        return (status == 301 || status == 302 || status == 303 || status == 307 || status == 308)
                && location.map(value -> value.contains("/admin/app")).orElse(false);
    }

    private HttpResponse<String> send(URI uri) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(TIMEOUT)
                .GET()
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
