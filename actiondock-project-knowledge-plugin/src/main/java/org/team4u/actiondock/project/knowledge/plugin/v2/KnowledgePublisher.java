package org.team4u.actiondock.project.knowledge.plugin.v2;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 知识库文档发布器。
 *
 * <p>将 staging 中的文档复制到仓库正式目录，并清理上次生成但本次不再需要的旧文件。
 * 支持增量发布：通过比较前后状态差异，仅处理变更的文件。
 */
final class KnowledgePublisher {

    /**
     * 执行发布：将 staging 文档复制到仓库正式目录，清理不再存在的旧文件。
     */
    PublishResult publish(Path repoRoot, RenderBundle render, KnowledgeState previousState) throws IOException {
        List<String> changedFiles = new ArrayList<>();
        for (DocumentRef document : render.documents()) {
            Path source = render.stagingRoot().resolve(document.outputPath());
            Path target = repoRoot.resolve(document.outputPath());
            copy(source, target);
            changedFiles.add(document.outputPath());
        }
        List<String> removedFiles = cleanupRemoved(repoRoot, previousState, new LinkedHashSet<>(render.state().generatedFiles()));
        KnowledgeState state = new KnowledgeState(
                new LinkedHashMap<>(render.state().documents()),
                render.state().generatedFiles(),
                Instant.now().toString()
        );
        return new PublishResult(changedFiles, removedFiles, state);
    }

    /**
     * 清理上次生成但本次不再需要的文件，并移除因清理产生的空目录。
     */
    private List<String> cleanupRemoved(Path repoRoot, KnowledgeState previousState, Set<String> generatedFiles) throws IOException {
        if (previousState == null || previousState.generatedFiles().isEmpty()) {
            return List.of();
        }
        List<String> removed = new ArrayList<>();
        for (String previous : previousState.generatedFiles()) {
            if (generatedFiles.contains(previous)) {
                continue;
            }
            Path path = repoRoot.resolve(previous);
            Files.deleteIfExists(path);
            cleanupEmptyParents(repoRoot, path.getParent());
            removed.add(previous);
        }
        return removed;
    }

    private void copy(Path source, Path target) throws IOException {
        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
    }

    /** 从目标路径向上逐级清理空目录，遇到非空目录时停止。 */
    private void cleanupEmptyParents(Path repoRoot, Path path) {
        Path current = path;
        while (current != null && !current.equals(repoRoot)) {
            try {
                Files.deleteIfExists(current);
            } catch (DirectoryNotEmptyException ignored) {
                return;
            } catch (IOException exception) {
                throw new PluginRuntimeException("Cannot cleanup generated directory: " + current, exception);
            }
            current = current.getParent();
        }
    }
}
