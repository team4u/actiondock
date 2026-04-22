package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

public final class CliConfigService {
    public static final String ENV_PROFILE = "SCRIPTFLOW_PROFILE";
    public static final String ENV_BASE_URL = "SCRIPTFLOW_BASE_URL";
    public static final String ENV_TOKEN = "SCRIPTFLOW_TOKEN";
    public static final int DEFAULT_CONNECT_TIMEOUT_MS = 5000;
    public static final int DEFAULT_READ_TIMEOUT_MS = 30000;
    public static final String DEFAULT_BASE_URL = "http://localhost:8080";
    public static final String DEFAULT_PROFILE = "default";

    private final ObjectMapper objectMapper;
    private final Map<String, String> environment;
    private final Path homeDirectory;

    public CliConfigService(ObjectMapper objectMapper, Map<String, String> environment, Path homeDirectory) {
        this.objectMapper = objectMapper;
        this.environment = environment;
        this.homeDirectory = homeDirectory;
    }

    public Path configPath() {
        return homeDirectory.resolve(".scriptflow").resolve("config.json");
    }

    public ConfigFile load() {
        Path path = configPath();
        if (Files.notExists(path)) {
            return new ConfigFile();
        }
        try {
            ConfigFile file = objectMapper.readValue(path.toFile(), ConfigFile.class);
            if (file.profiles == null) {
                file.profiles = new LinkedHashMap<>();
            }
            return file;
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    public void save(ConfigFile file) {
        try {
            Files.createDirectories(configPath().getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configPath().toFile(), file);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    public ResolvedConnectionConfig resolve(ResolutionRequest request) {
        ConfigFile file = load();
        ValueWithSource<String> profileValue = firstString(
                request.profile(),
                "FLAG",
                environment.get(ENV_PROFILE),
                "ENV",
                file.currentProfile,
                "PROFILE_FILE",
                DEFAULT_PROFILE,
                "DEFAULT"
        );
        String profileName = profileValue.value();
        ProfileConfig profile = file.profiles.getOrDefault(profileName, new ProfileConfig());

        ValueWithSource<String> baseUrlValue = firstString(
                normalizeBaseUrl(request.baseUrl()),
                "FLAG",
                normalizeBaseUrl(environment.get(ENV_BASE_URL)),
                "ENV",
                normalizeBaseUrl(profile.baseUrl),
                "PROFILE_FILE",
                DEFAULT_BASE_URL,
                "DEFAULT"
        );
        ValueWithSource<String> tokenValue = firstString(
                normalizeString(request.token()),
                "FLAG",
                normalizeString(environment.get(ENV_TOKEN)),
                "ENV",
                normalizeString(profile.token),
                "PROFILE_FILE",
                null,
                "NONE"
        );
        ValueWithSource<Integer> connectTimeoutValue = firstInteger(
                request.connectTimeoutMs(),
                "FLAG",
                profile.connectTimeoutMs,
                "PROFILE_FILE",
                DEFAULT_CONNECT_TIMEOUT_MS,
                "DEFAULT"
        );
        ValueWithSource<Integer> readTimeoutValue = firstInteger(
                request.readTimeoutMs(),
                "FLAG",
                profile.readTimeoutMs,
                "PROFILE_FILE",
                DEFAULT_READ_TIMEOUT_MS,
                "DEFAULT"
        );

        return new ResolvedConnectionConfig(
                profileName,
                baseUrlValue.value(),
                tokenValue.value(),
                connectTimeoutValue.value(),
                readTimeoutValue.value(),
                configPath(),
                profileValue.source(),
                baseUrlValue.source(),
                tokenValue.source(),
                connectTimeoutValue.source(),
                readTimeoutValue.source()
        );
    }

    public ObjectNode toResolvedNode(ResolvedConnectionConfig config) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("profile", config.profile());
        payload.put("profileSource", config.profileSource());
        payload.put("baseUrl", config.baseUrl());
        payload.put("baseUrlSource", config.baseUrlSource());
        payload.put("tokenPresent", config.token() != null && !config.token().isBlank());
        payload.put("tokenMasked", maskToken(config.token()));
        payload.put("tokenSource", config.tokenSource());
        payload.put("connectTimeoutMs", config.connectTimeoutMs());
        payload.put("connectTimeoutSource", config.connectTimeoutSource());
        payload.put("readTimeoutMs", config.readTimeoutMs());
        payload.put("readTimeoutSource", config.readTimeoutSource());
        payload.put("configFile", config.configPath().toString());
        return objectMapper.valueToTree(payload);
    }

    public ObjectNode toProfilesNode(ConfigFile file) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("currentProfile", normalizeString(file.currentProfile));
        payload.put("profiles", file.profiles.keySet());
        return objectMapper.valueToTree(payload);
    }

    public ObjectNode toProfileNode(String name, ProfileConfig profile, boolean current) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", name);
        payload.put("current", current);
        payload.put("baseUrl", normalizeBaseUrl(profile.baseUrl));
        payload.put("tokenPresent", profile.token != null && !profile.token.isBlank());
        payload.put("tokenMasked", maskToken(profile.token));
        payload.put("connectTimeoutMs", profile.connectTimeoutMs);
        payload.put("readTimeoutMs", profile.readTimeoutMs);
        return objectMapper.valueToTree(payload);
    }

    public String normalizeBaseUrl(String value) {
        String normalized = normalizeString(value);
        if (normalized == null) {
            return null;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized.isBlank() ? null : normalized;
    }

    public String normalizeString(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    public String maskToken(String value) {
        String normalized = normalizeString(value);
        if (normalized == null) {
            return null;
        }
        if (normalized.length() <= 4) {
            return "*".repeat(normalized.length());
        }
        return normalized.substring(0, 2) + "*".repeat(normalized.length() - 4) + normalized.substring(normalized.length() - 2);
    }

    private ValueWithSource<String> firstString(String preferredValue,
                                                String preferredSource,
                                                String fallbackValue,
                                                String fallbackSource,
                                                String nextValue,
                                                String nextSource,
                                                String defaultValue,
                                                String defaultSource) {
        if (preferredValue != null) {
            return new ValueWithSource<>(preferredValue, preferredSource);
        }
        if (fallbackValue != null) {
            return new ValueWithSource<>(fallbackValue, fallbackSource);
        }
        if (nextValue != null) {
            return new ValueWithSource<>(nextValue, nextSource);
        }
        return new ValueWithSource<>(defaultValue, defaultSource);
    }

    private ValueWithSource<Integer> firstInteger(Integer preferredValue,
                                                  String preferredSource,
                                                  Integer fallbackValue,
                                                  String fallbackSource,
                                                  int defaultValue,
                                                  String defaultSource) {
        if (preferredValue != null) {
            return new ValueWithSource<>(preferredValue, preferredSource);
        }
        if (fallbackValue != null) {
            return new ValueWithSource<>(fallbackValue, fallbackSource);
        }
        return new ValueWithSource<>(defaultValue, defaultSource);
    }

    public record ResolutionRequest(
            String profile,
            String baseUrl,
            String token,
            Integer connectTimeoutMs,
            Integer readTimeoutMs
    ) {
    }

    public record ResolvedConnectionConfig(
            String profile,
            String baseUrl,
            String token,
            int connectTimeoutMs,
            int readTimeoutMs,
            Path configPath,
            String profileSource,
            String baseUrlSource,
            String tokenSource,
            String connectTimeoutSource,
            String readTimeoutSource
    ) {
    }

    private record ValueWithSource<T>(T value, String source) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static final class ConfigFile {
        private String currentProfile;
        private Map<String, ProfileConfig> profiles = new LinkedHashMap<>();

        public String getCurrentProfile() {
            return currentProfile;
        }

        public void setCurrentProfile(String currentProfile) {
            this.currentProfile = currentProfile;
        }

        public Map<String, ProfileConfig> getProfiles() {
            return profiles;
        }

        public void setProfiles(Map<String, ProfileConfig> profiles) {
            this.profiles = profiles == null ? new LinkedHashMap<>() : new LinkedHashMap<>(profiles);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static final class ProfileConfig {
        private String baseUrl;
        private String token;
        private Integer connectTimeoutMs;
        private Integer readTimeoutMs;

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public String getToken() {
            return token;
        }

        public void setToken(String token) {
            this.token = token;
        }

        public Integer getConnectTimeoutMs() {
            return connectTimeoutMs;
        }

        public void setConnectTimeoutMs(Integer connectTimeoutMs) {
            this.connectTimeoutMs = connectTimeoutMs;
        }

        public Integer getReadTimeoutMs() {
            return readTimeoutMs;
        }

        public void setReadTimeoutMs(Integer readTimeoutMs) {
            this.readTimeoutMs = readTimeoutMs;
        }
    }
}
