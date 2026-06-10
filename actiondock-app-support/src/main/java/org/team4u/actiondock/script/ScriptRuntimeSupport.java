package org.team4u.actiondock.script;

import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.common.NormalizeUtils;

import java.nio.file.Path;
import java.util.UUID;

/**
 * 脚本运行时支持工具类，提供上下文信息构建和产物目录解析。
 * <p>
 * 为 Groovy 和 Python 脚本引擎提供共享的运行时上下文构建能力。
 *
 * @author jay.wu
 */
final class ScriptRuntimeSupport {
    private ScriptRuntimeSupport() {
    }

    static Path artifactDir(AppProperties properties, ScriptExecutionContext executionContext) {
        AppProperties effective = properties == null ? new AppProperties() : properties;
        String root = effective.getExecution().getArtifactRootDir();
        Path artifactRoot = NormalizeUtils.isBlank(root)
                ? Path.of(effective.getHomeDir(), "runs")
                : Path.of(root);
        String executionId = executionContext == null ? null : executionContext.getExecutionId();
        if (NormalizeUtils.isBlank(executionId)) {
            executionId = "adhoc-" + UUID.randomUUID();
        }
        return artifactRoot.toAbsolutePath().normalize().resolve(executionId).normalize();
    }

    static ScriptRuntimeContext context(AppProperties properties, ScriptExecutionContext executionContext) {
        Path artifactDir = artifactDir(properties, executionContext);
        return new ScriptRuntimeContext(executionContext, artifactDir.toString());
    }
}
