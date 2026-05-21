package org.team4u.actiondock.project.knowledge.plugin.domain;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * 知识库维护请求。
 *
 * <p>封装知识库维护操作所需的全部参数，包括目标仓库路径、操作类型、执行器选择等。
 * 提供从参数 Map 构建请求的工厂方法，自动推断操作类型和默认执行器。
 *
 * @param repoPath               目标仓库的绝对路径
 * @param operation              操作类型（{@code init} 初始化 / {@code refresh} 刷新）
 * @param resume                 是否从上一次中断处恢复
 * @param dryRun                 仅规划不实际执行
 * @param executor               原子任务执行器标识（{@code builtin-agent}、{@code external-cli}）
 * @param agentProfile           AI Agent 配置标识，为 {@code null} 时使用本地回退策略
 * @param externalCommandProfile 外部命令配置标识（如 {@code claude-code}）
 * @param evidenceFiles          额外证据文件列表
 */
public record MaintenanceRequest(
        Path repoPath,
        String operation,
        boolean resume,
        boolean dryRun,
        String executor,
        String agentProfile,
        String externalCommandProfile,
        List<String> evidenceFiles
) {
    /**
     * 从参数 Map 构建维护请求。
     *
     * <p>自动推断操作类型：若未指定 {@code operation}，则根据入口文件是否存在判断为 {@code init} 或 {@code refresh}。
     * 未指定 {@code executor} 时默认使用 {@code builtin-agent}。
     *
     * @param values 参数 Map，支持 repoPath、operation、resume、dryRun、executor、agentProfile、externalCommandProfile、evidenceFiles
     * @return 构建完成的维护请求
     * @throws PluginRuntimeException repoPath 缺失、路径无效或 operation 非法
     */
    public static MaintenanceRequest from(Map<String, Object> values) {
        // 解析并校验仓库路径（必填）
        Path root = repoPath(values);

        // 自动推断操作类型：未指定时根据入口文件是否存在判断
        String operation = optionalString(values.get("operation"));
        if (operation == null || operation.isBlank()) {
            operation = Files.exists(root.resolve(KnowledgeConstants.ENTRY_PATH)) ? "refresh" : "init";
        }
        operation = operation.toLowerCase(Locale.ROOT);
        if (!operation.equals("init") && !operation.equals("refresh")) {
            throw new PluginRuntimeException("operation must be init or refresh");
        }

        // 未指定执行器时默认使用内置 AI Agent
        String executor = optionalString(values.get("executor"));
        if (executor == null || executor.isBlank()) {
            executor = "builtin-agent";
        }

        return new MaintenanceRequest(
                root,
                operation,
                booleanValue(values.get("resume"), true),
                booleanValue(values.get("dryRun"), false),
                executor,
                optionalString(values.get("agentProfile")),
                optionalString(values.get("externalCommandProfile")),
                stringList(values.get("evidenceFiles"))
        );
    }

    private static Path repoPath(Map<String, Object> values) {
        String repoPath = optionalString(values.get("repoPath"));
        if (repoPath == null || repoPath.isBlank()) {
            throw new PluginRuntimeException("repoPath is required");
        }
        // 转换为绝对路径并规范化，消除路径中的 . 和 .. 段
        try {
            return Paths.get(repoPath).toAbsolutePath().normalize();
        } catch (InvalidPathException exception) {
            throw new PluginRuntimeException("Invalid repoPath: " + repoPath, exception);
        }
    }

    private static String optionalString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean booleanValue(Object value, boolean defaultValue) {
        return value instanceof Boolean bool ? bool : defaultValue;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .filter(Objects::nonNull)
                .map(String::valueOf)
                .toList();
    }
}
