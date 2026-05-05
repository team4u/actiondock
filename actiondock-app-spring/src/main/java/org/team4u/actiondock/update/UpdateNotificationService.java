package org.team4u.actiondock.update;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * 统一的更新检查服务，用于不同发行组件的 npm 版本提醒。
 */
public final class UpdateNotificationService {
    private static final System.Logger log = System.getLogger(UpdateNotificationService.class.getName());
    public static final String DISABLE_ENV = "ACTIONDOCK_NO_UPDATE_NOTIFIER";
    private static final Duration DEFAULT_HTTP_TIMEOUT = Duration.ofSeconds(3);
    private static final URI DEFAULT_NPM_REGISTRY = URI.create("https://registry.npmjs.org/");

    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final Duration checkInterval;
    private final LatestVersionFetcher latestVersionFetcher;

    public UpdateNotificationService() {
        this(
                new ObjectMapper().findAndRegisterModules(),
                Clock.systemUTC(),
                Duration.ofHours(24),
                new HttpLatestVersionFetcher(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build(),
                        DEFAULT_NPM_REGISTRY
                )
        );
    }

    UpdateNotificationService(ObjectMapper objectMapper,
                              Clock clock,
                              Duration checkInterval,
                              LatestVersionFetcher latestVersionFetcher) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.checkInterval = Objects.requireNonNull(checkInterval, "checkInterval");
        this.latestVersionFetcher = Objects.requireNonNull(latestVersionFetcher, "latestVersionFetcher");
    }

    public Optional<UpdateNotification> checkForUpdate(UpdateNotificationRequest request) {
        Objects.requireNonNull(request, "request");
        if (isDisabled(request.environment()) || request.currentVersion() == null || request.currentVersion().isBlank()) {
            return Optional.empty();
        }

        UpdateCheckCache cache = readCache(request.cacheFile()).orElse(null);
        Instant now = clock.instant();
        if (cache != null && cache.lastCheckedAtEpochMillis() != null
                && Instant.ofEpochMilli(cache.lastCheckedAtEpochMillis()).plus(checkInterval).isAfter(now)) {
            return buildNotification(request, cache.latestVersion());
        }

        Optional<String> latestVersion = fetchLatestVersion(request.packageName());
        if (latestVersion.isPresent()) {
            writeCache(request.cacheFile(), new UpdateCheckCache(now.toEpochMilli(), latestVersion.get()));
            return buildNotification(request, latestVersion.get());
        }
        return cache == null ? Optional.empty() : buildNotification(request, cache.latestVersion());
    }

    private Optional<String> fetchLatestVersion(String packageName) {
        try {
            return latestVersionFetcher.fetchLatestVersion(packageName);
        } catch (IOException | InterruptedException exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return Optional.empty();
        }
    }

    private static Optional<UpdateNotification> buildNotification(UpdateNotificationRequest request, String latestVersion) {
        if (latestVersion == null || latestVersion.isBlank()) {
            return Optional.empty();
        }
        try {
            SemanticVersion current = SemanticVersion.parse(request.currentVersion());
            SemanticVersion latest = SemanticVersion.parse(latestVersion);
            if (latest.compareTo(current) <= 0) {
                return Optional.empty();
            }
        } catch (RuntimeException exception) {
            log.log(System.Logger.Level.DEBUG, "解析语义版本失败，跳过更新通知: {0}", exception.getMessage());
            return Optional.empty();
        }
        return Optional.of(new UpdateNotification(request.displayName(), request.currentVersion(), latestVersion, request.installCommand()));
    }

    private Optional<UpdateCheckCache> readCache(Path cacheFile) {
        if (cacheFile == null || !Files.isRegularFile(cacheFile)) {
            return Optional.empty();
        }
        try {
            return Optional.ofNullable(objectMapper.readValue(cacheFile.toFile(), UpdateCheckCache.class));
        } catch (IOException exception) {
            log.log(System.Logger.Level.DEBUG, "读取更新缓存失败: {0}", exception.getMessage());
            return Optional.empty();
        }
    }

    private void writeCache(Path cacheFile, UpdateCheckCache cache) {
        if (cacheFile == null) {
            return;
        }
        try {
            Files.createDirectories(cacheFile.getParent());
            objectMapper.writeValue(cacheFile.toFile(), cache);
        } catch (IOException exception) {
            log.log(System.Logger.Level.DEBUG, "写入更新缓存失败，更新提示不应阻塞主流程: {0}", exception.getMessage());
        }
    }

    private static boolean isDisabled(Map<String, String> environment) {
        if (environment == null) {
            return false;
        }
        String value = environment.get(DISABLE_ENV);
        if (value == null) {
            return false;
        }
        String normalized = value.trim().toLowerCase();
        return "1".equals(normalized) || "true".equals(normalized) || "yes".equals(normalized) || "on".equals(normalized);
    }

    public record UpdateNotification(String displayName, String currentVersion, String latestVersion, String installCommand) {
        public String message() {
            return "A newer " + displayName + " is available: " + latestVersion
                    + " (current " + currentVersion + "). Run: " + installCommand;
        }
    }

    public record UpdateNotificationRequest(String componentKey,
                                            String packageName,
                                            String displayName,
                                            String currentVersion,
                                            String installCommand,
                                            Path homeDirectory,
                                            Map<String, String> environment) {
        public UpdateNotificationRequest {
            Objects.requireNonNull(componentKey, "componentKey");
            Objects.requireNonNull(packageName, "packageName");
            Objects.requireNonNull(displayName, "displayName");
            Objects.requireNonNull(installCommand, "installCommand");
            Objects.requireNonNull(homeDirectory, "homeDirectory");
        }

        Path cacheFile() {
            return homeDirectory.resolve(".actiondock").resolve("update-check").resolve(componentKey + ".json");
        }
    }

    @FunctionalInterface
    interface LatestVersionFetcher {
        Optional<String> fetchLatestVersion(String packageName) throws IOException, InterruptedException;
    }

    static record UpdateCheckCache(Long lastCheckedAtEpochMillis, String latestVersion) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    static record LatestVersionPayload(String version) {
    }

    private static final class HttpLatestVersionFetcher implements LatestVersionFetcher {
        private final HttpClient httpClient;
        private final URI registryBaseUri;
        private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

        private HttpLatestVersionFetcher(HttpClient httpClient, URI registryBaseUri) {
            this.httpClient = httpClient;
            this.registryBaseUri = registryBaseUri;
        }

        @Override
        public Optional<String> fetchLatestVersion(String packageName) throws IOException, InterruptedException {
            String encodedPackageName = URLEncoder.encode(packageName, StandardCharsets.UTF_8).replace("+", "%20");
            URI uri = registryBaseUri.resolve(encodedPackageName + "/latest");
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .header("Accept", "application/json")
                    .timeout(DEFAULT_HTTP_TIMEOUT)
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return Optional.empty();
            }
            LatestVersionPayload payload = objectMapper.readValue(response.body(), LatestVersionPayload.class);
            return payload.version() == null || payload.version().isBlank()
                    ? Optional.empty()
                    : Optional.of(payload.version().trim());
        }
    }
}
