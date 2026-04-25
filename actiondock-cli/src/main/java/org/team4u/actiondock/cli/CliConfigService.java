package org.team4u.actiondock.cli;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * CLI 配置服务，管理连接 profile 的加载、保存和多层级配置解析。
 * <p>
 * 配置优先级：命令行参数 > 环境变量 > profile 文件 > 默认值。
 *
 * @author jay.wu
 */
public final class CliConfigService {
    public static final String ENV_PROFILE = "ACTIONDOCK_PROFILE";
    public static final String ENV_BASE_URL = "ACTIONDOCK_BASE_URL";
    public static final String ENV_TOKEN = "ACTIONDOCK_TOKEN";
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

    /**
     * 获取 CLI 配置文件路径。
     *
     * @return 配置文件路径，位于用户主目录下的 {@code .actiondock/config.json}
     */
    public Path configPath() {
        return homeDirectory.resolve(".actiondock").resolve("config.json");
    }

    /**
     * 加载 CLI 配置文件。
     * <p>
     * 如果配置文件不存在则返回空的 {@link ConfigFile}。
     *
     * @return 配置文件对象
     * @throws UncheckedIOException 如果配置文件读取或解析失败
     */
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

    /**
     * 保存 CLI 配置到文件系统。
     * <p>
     * 自动创建父目录，以 JSON 格式写入配置。
     *
     * @param file 要保存的配置文件对象
     * @throws UncheckedIOException 如果写入失败
     */
    public void save(ConfigFile file) {
        try {
            Files.createDirectories(configPath().getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configPath().toFile(), file);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    /**
     * 解析最终生效的连接配置。
     * <p>
     * 按优先级合并：命令行参数 > 环境变量 > profile 文件 > 默认值，
     * 返回包含每个配置项来源信息的解析结果。
     *
     * @param request 包含命令行传入的配置覆盖项
     * @return 包含最终配置值和来源信息的解析结果
     */
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

    /**
     * 将解析后的连接配置转换为 JSON 节点，用于 CLI 输出。
     * <p>
     * 包含 profile、baseUrl、token（脱敏）、超时和配置文件路径等信息。
     *
     * @param config 解析后的连接配置
     * @return 包含完整连接信息的 JSON 节点
     */
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

    /**
     * 将配置文件中的 profile 列表转换为 JSON 节点。
     *
     * @param file CLI 配置文件
     * @return 包含当前 profile 名称和所有 profile 名称列表的 JSON 节点
     */
    public ObjectNode toProfilesNode(ConfigFile file) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("currentProfile", normalizeString(file.currentProfile));
        payload.put("profiles", file.profiles.keySet());
        return objectMapper.valueToTree(payload);
    }

    /**
     * 将单个 profile 配置转换为 JSON 节点。
     *
     * @param name    profile 名称
     * @param profile profile 配置
     * @param current 是否为当前激活的 profile
     * @return 包含 profile 详情的 JSON 节点
     */
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

    /**
     * 规范化服务端基础 URL。
     * <p>
     * 去除首尾空白和末尾的斜杠，空字符串视为 null。
     *
     * @param value 原始 URL 值
     * @return 规范化后的 URL，无效值返回 null
     */
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

    /**
     * 规范化字符串值。
     * <p>
     * 去除首尾空白，空字符串转为 null。
     *
     * @param value 原始字符串
     * @return 规范化后的字符串，空白值返回 null
     */
    public String normalizeString(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    /**
     * 对令牌进行脱敏处理。
     * <p>
     * 保留首尾各 2 个字符，中间用星号替换。长度不超过 4 则全部脱敏。
     *
     * @param value 原始令牌值
     * @return 脱敏后的令牌字符串
     */
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
