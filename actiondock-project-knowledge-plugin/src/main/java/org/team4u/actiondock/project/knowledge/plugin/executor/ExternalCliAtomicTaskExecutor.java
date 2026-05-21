package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;
import org.team4u.actiondock.project.knowledge.plugin.parser.AiOutputParser;
import org.team4u.actiondock.project.knowledge.plugin.parser.ParsedAiOutput;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ExternalCliAtomicTaskExecutor implements AtomicTaskExecutor {
    private final AtomicTaskExecutor fallback;
    private final AiOutputParser outputParser = new AiOutputParser();

    public ExternalCliAtomicTaskExecutor(AtomicTaskExecutor fallback) {
        this.fallback = fallback;
    }

    @Override
    public TaskResult execute(ScriptPluginContext context, MaintenanceRequest request, RepositoryFacts facts, AtomicTask task, String template) {
        if (request.externalCommandProfile() == null || request.externalCommandProfile().isBlank()) {
            return fallback.execute(context, request, facts, task, template);
        }
        List<String> command = switch (request.externalCommandProfile()) {
            case "claude-code" -> List.of("claude", "-p", atomicPrompt(task, template));
            default -> List.of();
        };
        if (command.isEmpty()) {
            return new TaskResult(task.id(), task.taskType(), "skipped", null, java.util.Map.of("message", "External command profile is not allowed."), "profile-not-allowed", task.outputPath());
        }
        try {
            Process process = new ProcessBuilder(command)
                    .directory(facts.root().toFile())
                    .redirectErrorStream(true)
                    .start();
            boolean finished = process.waitFor(120, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                return new TaskResult(task.id(), task.taskType(), "needs_review", null, java.util.Map.of("message", "External command timed out."), "timeout", task.outputPath());
            }
            String raw = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            ParsedAiOutput parsed = outputParser.parse(raw);
            String status = process.exitValue() == 0 ? parsed.status() : "needs_review";
            return new TaskResult(task.id(), task.taskType(), status, raw, parsed.parsedOutput(), parsed.parseError(), task.outputPath());
        } catch (Exception exception) {
            return new TaskResult(task.id(), task.taskType(), "needs_review", null, java.util.Map.of("message", exception.getMessage()), "external-cli-error", task.outputPath());
        }
    }

    private String atomicPrompt(AtomicTask task, String template) {
        return """
                Execute one project-knowledge atomic task only.
                Task id: %s
                Task type: %s
                Title: %s
                Evidence: %s
                Template: %s
                Return JSON if possible. Readable text is acceptable if JSON is not possible.
                """.formatted(task.id(), task.taskType(), task.title(), task.evidence(), template);
    }
}
