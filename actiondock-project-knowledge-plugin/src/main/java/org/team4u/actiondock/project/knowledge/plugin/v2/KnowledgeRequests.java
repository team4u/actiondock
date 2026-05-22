package org.team4u.actiondock.project.knowledge.plugin.v2;

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
     * 解析 generate 操作的请求参数。
     *
     * @param values 插件传入的原始参数 Map
     * @return 解析后的类型安全请求对象
     * @throws PluginRuntimeException repoPath 为空时
     */
    static KnowledgeRequest generate(Map<String, Object> values) {
        return new KnowledgeRequest(
                repoPath(values),
                stringList(values.get("evidenceFiles")),
                defaultString(values.get("audience"), "balanced"),
                defaultString(values.get("detailLevel"), "standard"),
                aiProfile(values)
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

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String defaultString(Object value, String defaultValue) {
        String string = string(value);
        return string == null || string.isBlank() ? defaultValue : string;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().filter(Objects::nonNull).map(String::valueOf).toList();
    }
}
