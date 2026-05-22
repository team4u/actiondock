package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 知识库插件请求参数解析工具。
 *
 * <p>将插件 invoke 传入的 {@code Map<String, Object>} 参数解析为类型安全的请求对象。
 * AI profile 的解析支持多种来源优先级：aiProfile > aiProfiles.writer > aiProfiles.discovery > agentProfile。
 */
final class KnowledgeRequests {
    private KnowledgeRequests() {
    }

    /**
     * 解析 init 操作的请求参数。
     */
    static KnowledgeRequest init(Map<String, Object> values) {
        return request(values, "init");
    }

    /**
     * 解析 refresh 操作的请求参数。
     */
    static KnowledgeRequest refresh(Map<String, Object> values) {
        return request(values, "refresh");
    }

    /**
     * 解析 ingest 操作的请求参数。
     */
    static KnowledgeRequest ingest(Map<String, Object> values) {
        return request(values, "ingest");
    }

    /**
     * 通用请求参数解析，提取仓库路径、证据文件、受众、详细程度和 AI profile。
     *
     * @param values 插件 invoke 传入的原始参数 Map
     * @param mode   当前流水线模式（init / refresh / ingest）
     * @return 类型安全的请求对象
     */
    static KnowledgeRequest request(Map<String, Object> values, String mode) {
        RunnerSpec runner = runner(values);
        String profile = runner.aiProfile() == null || runner.aiProfile().isBlank() ? aiProfile(values) : runner.aiProfile();
        return new KnowledgeRequest(
                repoPath(values),
                stringList(values.get("evidenceFiles")),
                stringList(values.get("sources")),
                stringList(values.get("changedFiles")),
                defaultString(values.get("audience"), "balanced"),
                defaultString(values.get("detailLevel"), "standard"),
                profile,
                new RunnerSpec(runner.type(), profile, runner.command(), runner.envKeys(), runner.timeoutSeconds()),
                mode
        );
    }

    /**
     * 解析 validate 操作的请求参数，仅提取仓库路径。
     */
    static Path validate(Map<String, Object> values) {
        return repoPath(values);
    }

    /**
     * 按优先级解析 AI profile：aiProfile > aiProfiles.writer > aiProfiles.discovery > agentProfile。
     */
    private static String aiProfile(Map<String, Object> values) {
        String direct = string(values.get("aiProfile"));
        if (direct != null && !direct.isBlank()) {
            return direct;
        }
        Object raw = values.get("aiProfiles");
        if (raw instanceof Map<?, ?> map) {
            String writer = string(map.get("writer"));
            if (writer != null && !writer.isBlank()) {
                return writer;
            }
            String discovery = string(map.get("discovery"));
            if (discovery != null && !discovery.isBlank()) {
                return discovery;
            }
        }
        return string(values.get("agentProfile"));
    }

    /**
     * 从参数中解析 Agent Runner 配置。
     * 支持 runner.type / runner.aiProfile / runner.command / runner.envKeys / runner.timeoutSeconds 字段，
     * 同时兼容顶层 runnerType / timeoutSeconds 简写。
     */
    @SuppressWarnings("unchecked")
    private static RunnerSpec runner(Map<String, Object> values) {
        Object raw = values.get("runner");
        Map<String, Object> runner = raw instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
        String type = defaultString(runner.get("type"), defaultString(values.get("runnerType"), "internal"));
        String profile = string(runner.get("aiProfile"));
        if (profile == null || profile.isBlank()) {
            profile = string(runner.get("profileId"));
        }
        if (profile == null || profile.isBlank()) {
            profile = aiProfile(values);
        }
        int timeoutSeconds = intValue(runner.get("timeoutSeconds"), intValue(values.get("timeoutSeconds"), 600));
        return new RunnerSpec(
                type,
                profile,
                stringList(runner.get("command")),
                stringList(runner.get("envKeys")),
                timeoutSeconds
        );
    }

    /**
     * 解析并校验仓库路径，必须为有效目录的绝对路径。
     */
    private static Path repoPath(Map<String, Object> values) {
        String repoPath = string(values.get("repoPath"));
        if (repoPath == null || repoPath.isBlank()) {
            throw new PluginRuntimeException("repoPath is required");
        }
        try {
            return Paths.get(repoPath).toAbsolutePath().normalize();
        } catch (Exception exception) {
            throw new PluginRuntimeException("Invalid repoPath: " + repoPath, exception);
        }
    }

    /**
     * 安全地将 Object 转为 String，null 返回 null。
     */
    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 取字符串值，为空或空白时返回默认值。
     */
    private static String defaultString(Object value, String defaultValue) {
        String string = string(value);
        return string == null || string.isBlank() ? defaultValue : string;
    }

    /**
     * 将 Object 转为字符串列表，过滤 null 元素；非 List 类型返回空列表。
     */
    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().filter(Objects::nonNull).map(String::valueOf).toList();
    }

    /**
     * 将 Object 转为正整数（最小值 1），解析失败返回默认值。
     */
    private static int intValue(Object value, int defaultValue) {
        if (value instanceof Number number) {
            return Math.max(1, number.intValue());
        }
        if (value != null) {
            try {
                return Math.max(1, Integer.parseInt(String.valueOf(value)));
            } catch (NumberFormatException ignored) {
            }
        }
        return defaultValue;
    }
}
