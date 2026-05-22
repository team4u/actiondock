package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;

/**
 * 文件型异步任务状态存储。
 *
 * <p>将每次知识库异步任务的状态（RUNNING / SUCCESS / FAILED / CANCELLED）持久化为 JSON 文件，
 * 存放在 {@code .actiondock/project-knowledge/runs/<runId>.json}。支持创建、加载和状态变更操作。
 */
final class KnowledgeAsyncRunStore {
    private final Path repoRoot;

    KnowledgeAsyncRunStore(Path repoRoot) {
        this.repoRoot = repoRoot;
    }

    /**
     * 创建一个新的 RUNNING 状态快照并持久化。
     *
     * @param runId 任务唯一标识
     * @param mode  流水线模式（init / refresh / ingest）
     * @return 初始状态快照
     */
    KnowledgeRunSnapshot create(String runId, String mode) {
        KnowledgeRunSnapshot snapshot = new KnowledgeRunSnapshot(
                runId,
                mode,
                "RUNNING",
                repoRoot.toString(),
                Instant.now().toString(),
                null,
                Map.of(),
                null
        );
        save(snapshot);
        return snapshot;
    }

    /**
     * 加载指定 runId 的任务快照。
     *
     * @param runId 任务唯一标识
     * @return 已持久化的任务快照
     * @throws PluginRuntimeException 指定的 runId 不存在
     */
    KnowledgeRunSnapshot load(String runId) {
        Path path = path(runId);
        if (!Files.exists(path)) {
            throw new PluginRuntimeException("Knowledge run not found: " + runId);
        }
        return JsonFiles.read(path, KnowledgeRunSnapshot.class);
    }

    /** 将任务状态更新为 SUCCESS，并记录生成结果。 */
    void success(KnowledgeRunSnapshot current, Map<String, Object> result) {
        if (cancelled(current.runId())) {
            return;
        }
        save(new KnowledgeRunSnapshot(
                current.runId(),
                current.mode(),
                "SUCCESS",
                current.repoPath(),
                current.startedAt(),
                Instant.now().toString(),
                result,
                null
        ));
    }

    /** 将任务状态更新为 FAILED，并记录错误信息。 */
    void failed(KnowledgeRunSnapshot current, String message) {
        if (cancelled(current.runId())) {
            return;
        }
        save(new KnowledgeRunSnapshot(
                current.runId(),
                current.mode(),
                "FAILED",
                current.repoPath(),
                current.startedAt(),
                Instant.now().toString(),
                current.result(),
                message
        ));
    }

    /**
     * 检查指定任务是否已被取消。
     *
     * <p>用于流水线完成后判断是否应写入结果——若已取消则跳过状态更新。
     *
     * @param runId 任务唯一标识
     * @return 已取消返回 {@code true}，任务不存在也返回 {@code false}
     */
    boolean cancelled(String runId) {
        Path path = path(runId);
        if (!Files.exists(path)) {
            return false;
        }
        return "CANCELLED".equals(load(runId).status());
    }

    /** 将任务状态更新为 CANCELLED，不可逆操作。 */
    void cancelled(KnowledgeRunSnapshot current) {
        save(new KnowledgeRunSnapshot(
                current.runId(),
                current.mode(),
                "CANCELLED",
                current.repoPath(),
                current.startedAt(),
                Instant.now().toString(),
                current.result(),
                "Cancelled by request"
        ));
    }

    private void save(KnowledgeRunSnapshot snapshot) {
        JsonFiles.write(path(snapshot.runId()), snapshot);
    }

    private Path path(String runId) {
        return repoRoot.resolve(KnowledgeConstants.WORKSPACE_ROOT).resolve("runs").resolve(runId + ".json");
    }
}
