package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryInventory;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;
import org.team4u.actiondock.project.knowledge.plugin.parser.AiOutputParser;
import org.team4u.actiondock.project.knowledge.plugin.parser.ParsedAiOutput;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 外部 CLI 原子任务执行器。
 *
 * <p>通过启动外部命令行工具（如 Claude Code）执行原子任务。将任务描述作为 prompt 传入外部工具，
 * 超时时间限制为 120 秒。未配置外部命令 Profile 时回退到本地策略。
 *
 * @author ActionDock
 */
public class ExternalCliAtomicTaskExecutor implements AtomicTaskExecutor {
    private final AtomicTaskExecutor fallback;
    private final AiOutputParser outputParser = new AiOutputParser();

    /**
     * 创建外部 CLI 执行器。
     *
     * @param fallback 外部命令不可用或未配置时的回退执行器
     */
    public ExternalCliAtomicTaskExecutor(AtomicTaskExecutor fallback) {
        this.fallback = fallback;
    }

    /**
     * 通过外部 CLI 执行原子任务。
     *
     * <p>当前仅支持 {@code claude-code} 命令 Profile，在仓库根目录下启动子进程执行。
     * 超时或进程异常退出时标记为 {@code needs_review}。
     *
     * @param context  脚本插件上下文
     * @param request 维护请求
     * @param facts   仓库扫描结果
     * @param task    待执行的原子任务
     * @param template 任务关联的模板内容
     * @return 任务执行结果
     */
    @Override
    public TaskResult execute(ScriptPluginContext context, MaintenanceRequest request, RepositoryFacts facts, AtomicTask task, String template) {
        // 未配置外部命令 Profile 时回退
        if (request.externalCommandProfile() == null || request.externalCommandProfile().isBlank()) {
            return fallback.execute(context, request, facts, task, template);
        }

        // 根据命令 Profile 构建对应的命令行参数
        List<String> command = switch (request.externalCommandProfile()) {
            case "claude-code" -> List.of("claude", "-p", atomicPrompt(task, template));
            default -> List.of();
        };
        // 不允许的命令 Profile 直接跳过
        if (command.isEmpty()) {
            return new TaskResult(task.id(), task.taskType(), "skipped", null, java.util.Map.of("message", "External command profile is not allowed."), "profile-not-allowed", task.outputPath());
        }

        try {
            // 在仓库根目录下启动外部进程，合并 stderr 到 stdout
            Process process = new ProcessBuilder(command)
                    .directory(facts.root().toFile())
                    .redirectErrorStream(true)
                    .start();

            // 等待进程完成，超时 120 秒后强制终止
            boolean finished = process.waitFor(120, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                return new TaskResult(task.id(), task.taskType(), "needs_review", null, java.util.Map.of("message", "External command timed out."), "timeout", task.outputPath());
            }

            // 读取输出并解析；进程非零退出码时强制标记为 needs_review
            String raw = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            ParsedAiOutput parsed = outputParser.parse(raw);
            String status = process.exitValue() == 0 ? parsed.status() : "needs_review";
            return new TaskResult(task.id(), task.taskType(), status, raw, parsed.parsedOutput(), parsed.parseError(), task.outputPath());
        } catch (Exception exception) {
            return new TaskResult(task.id(), task.taskType(), "needs_review", null, java.util.Map.of("message", exception.getMessage()), "external-cli-error", task.outputPath());
        }
    }

    @Override
    public Map<String, Object> scanRepository(ScriptPluginContext context,
                                              MaintenanceRequest request,
                                              RepositoryInventory inventory,
                                              String prompt) {
        if (request.externalCommandProfile() == null || request.externalCommandProfile().isBlank()) {
            throw new PluginRuntimeException("externalCommandProfile is required for repository scan.");
        }
        List<String> command = switch (request.externalCommandProfile()) {
            case "claude-code" -> List.of("claude", "-p", prompt);
            default -> List.of();
        };
        if (command.isEmpty()) {
            throw new PluginRuntimeException("Repository scan external command profile is not allowed: " + request.externalCommandProfile());
        }
        try {
            Process process = new ProcessBuilder(command)
                    .directory(inventory.root().toFile())
                    .redirectErrorStream(true)
                    .start();
            boolean finished = process.waitFor(120, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new PluginRuntimeException("Repository scan timed out.");
            }
            String raw = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (process.exitValue() != 0) {
                throw new PluginRuntimeException("Repository scan failed: " + raw);
            }
            ParsedAiOutput parsed = outputParser.parse(raw);
            if (!parsed.parsed()) {
                throw new PluginRuntimeException("Repository scan returned invalid JSON: " + parsed.parseError());
            }
            return new LinkedHashMap<>(parsed.parsedOutput());
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Repository scan failed: " + exception.getMessage(), exception);
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
