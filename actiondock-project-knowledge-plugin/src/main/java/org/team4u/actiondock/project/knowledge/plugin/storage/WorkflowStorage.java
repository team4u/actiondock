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

public class WorkflowStorage {
    private final Path root;
    private final Path tempRoot;

    public WorkflowStorage(Path root) {
        this.root = root;
        this.tempRoot = root.resolve(KnowledgeConstants.TEMP_ROOT);
    }

    public Path tempRoot() {
        return tempRoot;
    }

    public void saveCheckpoint(WorkflowRun run) {
        Map<String, Object> checkpoint = run.toCheckpoint();
        checkpoint.put("checkpointPath", tempRoot.resolve(KnowledgeConstants.CHECKPOINT_FILE).toString());
        JsonSupport.writeJson(tempRoot.resolve(KnowledgeConstants.CHECKPOINT_FILE), checkpoint);
        JsonSupport.writeJson(tempRoot.resolve(KnowledgeConstants.LATEST_RUN_FILE), checkpoint);
    }

    public void savePlan(Map<String, Object> plan) {
        JsonSupport.writeJson(tempRoot.resolve("task-plan.json"), plan);
    }

    public void saveTaskTrace(AtomicTask task, TaskResult result) {
        Map<String, Object> trace = new LinkedHashMap<>();
        trace.put("task", task);
        trace.put("result", result);
        JsonSupport.writeJson(tempRoot.resolve("task-traces").resolve(task.id() + ".json"), trace);
    }

    public void writeTaskOutput(TaskResult result) {
        if (result.outputPath() == null || result.outputPath().isBlank()) {
            return;
        }
        JsonSupport.writeJson(root.resolve(result.outputPath()), result.parsedOutput());
    }

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
