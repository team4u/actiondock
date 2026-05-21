package org.team4u.actiondock.project.knowledge.plugin.storage;

import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;
import org.team4u.actiondock.project.knowledge.plugin.domain.WorkflowRun;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 工作流存储服务。
 *
 * <p>管理工作流运行过程中的检查点、任务计划和任务追踪数据的持久化。
 * 所有中间数据存储在仓库根目录的 {@code .knowledge-tmp} 临时目录中。
 *
 * @author ActionDock
 */
public class WorkflowStorage {
    private final Path root;
    private final Path tempRoot;

    /**
     * 创建工作流存储实例。
     *
     * @param root 仓库根目录
     */
    public WorkflowStorage(Path root) {
        this.root = root;
        this.tempRoot = root.resolve(KnowledgeConstants.TEMP_ROOT);
    }

    /**
     * 获取临时工作目录路径。
     *
     * @return {@code .knowledge-tmp} 目录的绝对路径
     */
    public Path tempRoot() {
        return tempRoot;
    }

    /**
     * 保存工作流检查点到文件，同时更新最新运行记录。
     *
     * @param run 工作流运行实例
     */
    public void saveCheckpoint(WorkflowRun run) {
        Map<String, Object> checkpoint = run.toCheckpoint();
        checkpoint.put("checkpointPath", tempRoot.resolve(KnowledgeConstants.CHECKPOINT_FILE).toString());
        JsonSupport.writeJson(tempRoot.resolve(KnowledgeConstants.CHECKPOINT_FILE), checkpoint);
        JsonSupport.writeJson(tempRoot.resolve(KnowledgeConstants.LATEST_RUN_FILE), checkpoint);
    }

    /**
     * 保存任务计划。
     *
     * @param plan 任务计划数据
     */
    public void savePlan(Map<String, Object> plan) {
        JsonSupport.writeJson(tempRoot.resolve("task-plan.json"), plan);
    }

    /**
     * 保存单个原子任务的执行追踪记录。
     *
     * @param task   原子任务
     * @param result 任务执行结果
     */
    public void saveTaskTrace(AtomicTask task, TaskResult result) {
        Map<String, Object> trace = new LinkedHashMap<>();
        trace.put("task", task);
        trace.put("result", result);
        JsonSupport.writeJson(tempRoot.resolve("task-traces").resolve(task.id() + ".json"), trace);
    }

    /**
     * 将任务执行成功的产出写入目标文件。
     *
     * @param result 任务执行结果
     */
    public void writeTaskOutput(TaskResult result) {
        if (result.outputPath() == null || result.outputPath().isBlank()) {
            return;
        }
        JsonSupport.writeJson(root.resolve(result.outputPath()), result.parsedOutput());
    }

    /**
     * 查询工作流运行记录。
     *
     * <p>优先读取最新运行记录文件，若指定了 {@code runId} 则读取检查点文件。
     *
     * @param runId 运行 ID，为 {@code null} 时读取最新运行记录
     * @return 运行记录数据，包含状态和检查点内容
     * @throws IOException 文件读取失败
     */
    public Map<String, Object> getRun(String runId) throws IOException {
        Path path = tempRoot.resolve(KnowledgeConstants.LATEST_RUN_FILE);
        if (runId != null && !runId.isBlank()) {
            path = tempRoot.resolve(KnowledgeConstants.CHECKPOINT_FILE);
        }
        if (!Files.exists(path)) {
            return Map.of("runId", runId, "status", "NOT_FOUND", "checkpointPath", path.toString());
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("status", "FOUND");
        result.put("checkpointPath", path.toString());
        result.put("content", Files.readString(path, StandardCharsets.UTF_8));
        return result;
    }
}
