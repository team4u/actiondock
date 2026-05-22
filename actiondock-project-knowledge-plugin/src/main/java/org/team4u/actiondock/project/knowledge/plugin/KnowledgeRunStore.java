package org.team4u.actiondock.project.knowledge.plugin;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 知识库运行状态持久化。
 *
 * <p>读写 {@code .actiondock/project-knowledge/state.json}，记录已发布文档的 fingerprint 和时间戳，
 * 用于增量发布时判断哪些文件需要清理。
 */
final class KnowledgeRunStore {
    private final Path repoRoot;

    KnowledgeRunStore(Path repoRoot) {
        this.repoRoot = repoRoot;
    }

    /** 加载上一次的持久化状态，文件不存在时返回空状态。 */
    KnowledgeState loadState() {
        Path path = repoRoot.resolve(KnowledgeConstants.STATE_FILE);
        if (!Files.exists(path)) {
            return new KnowledgeState(Map.of(), List.of(), null);
        }
        return JsonFiles.read(path, KnowledgeState.class);
    }

    /** 将当前发布状态持久化到 state.json。 */
    void saveState(KnowledgeState state) {
        JsonFiles.write(repoRoot.resolve(KnowledgeConstants.STATE_FILE), state);
    }

    /** 返回状态文件的完整路径。 */
    Path statePath() {
        return repoRoot.resolve(KnowledgeConstants.STATE_FILE);
    }
}
