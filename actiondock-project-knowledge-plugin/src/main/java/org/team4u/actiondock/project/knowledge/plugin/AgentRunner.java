package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Agent 执行器抽象接口。
 *
 * <p>所有 Agent 执行器（内置 / 外部 CLI）均实现此接口，统一 {@code run} 签名。
 */
interface AgentRunner {
    /**
     * 执行单个 Agent 任务并返回结构化结果。
     *
     * @param context 插件脚本上下文
     * @param request 知识库生成请求
     * @param task    当前待执行的 Agent 任务描述
     * @return Agent 执行后的结构化 JSON 和警告列表
     */
    AgentTaskResult run(ScriptPluginContext context, KnowledgeRequest request, AgentTask task);
}

/**
 * Agent Runner 工厂，根据请求配置选择内置 Agent 或外部 CLI Agent。
 *
 * <p>当 {@code request.runner()} 未指定或 type 为 "internal" 时使用内置 Agent；
 * type 为 "external-cli" 时使用外部命令行 Agent（如 {@code claude -p}）。
 */
final class AgentRunners {
    private final AiAgentRuntime runtime;

    AgentRunners(AiAgentRuntime runtime) {
        this.runtime = runtime;
    }

    /**
     * 根据请求中的 runner 配置解析具体的 Agent 执行器实例。
     *
     * @param request 知识库生成请求，包含 runner 配置
     * @return 匹配的 AgentRunner 实现
     */
    AgentRunner resolve(KnowledgeRequest request) {
        String type = request.runner() == null ? "internal" : request.runner().type();
        if ("external-cli".equals(type)) {
            return new ExternalCliAgentRunner();
        }
        return new InternalAgentRunner(new AiJsonSupport(runtime));
    }
}

/**
 * 内置 ActionDock Agent Runner。
 *
 * <p>通过 {@link AiJsonSupport} 调用平台内置的 AI Agent 运行时，
 * 要求传入有效的 {@code aiProfile}，否则抛出异常。
 */
final class InternalAgentRunner implements AgentRunner {
    private final AiJsonSupport aiSupport;

    InternalAgentRunner(AiJsonSupport aiSupport) {
        this.aiSupport = aiSupport;
    }

    @Override
    public AgentTaskResult run(ScriptPluginContext context, KnowledgeRequest request, AgentTask task) {
        if (!aiSupport.available(request.aiProfile())) {
            throw new PluginRuntimeException("Internal agent runner requires aiProfile");
        }
        // 调用 AI Agent，将 system/user 提示词、结构化输入和元数据一并传入
        Map<String, Object> json = aiSupport.runJson(
                context,
                request.aiProfile(),
                task.systemPrompt(),
                task.userPrompt(),
                task.input(),
                Map.of("phase", request.mode(), "structuredOutputReminder", "JSON"),
                Map.of("pluginId", ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID, "phase", request.mode(), "taskId", task.taskId())
        );
        return new AgentTaskResult("", json, List.of());
    }
}

/**
 * 外部 CLI Agent Runner，支持调用如 {@code claude -p} 等命令行 AI 工具。
 *
 * <p>将 Agent 任务组装为 prompt 字符串，附加到配置的命令后执行子进程。
 * 期望外部 Agent 在标准输出中以 {@code <OCKB_JSON>} 标签包裹返回 JSON 对象。
 * 支持：超时控制、环境变量白名单透传、stderr 收集为警告。
 */
final class ExternalCliAgentRunner implements AgentRunner {
    @Override
    public AgentTaskResult run(ScriptPluginContext context, KnowledgeRequest request, AgentTask task) {
        RunnerSpec spec = request.runner();
        if (spec == null || spec.command() == null || spec.command().isEmpty()) {
            throw new PluginRuntimeException("External CLI runner requires runner.command");
        }
        String payload = externalPrompt(task);
        List<String> command = new ArrayList<>(spec.command());
        command.add(payload); // 将完整 prompt 作为最后一个参数传入
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(request.repoPath().toFile()); // 工作目录设为仓库根目录
        // 如果指定了环境变量白名单，则只透传允许的变量
        Map<String, String> env = builder.environment();
        if (spec.envKeys() != null && !spec.envKeys().isEmpty()) {
            Map<String, String> filtered = new LinkedHashMap<>();
            for (String key : spec.envKeys()) {
                String value = System.getenv(key);
                if (value != null) {
                    filtered.put(key, value);
                }
            }
            env.clear();
            env.putAll(filtered);
        }
        try {
            Process process = builder.start();
            ByteArrayOutputStream stdout = new ByteArrayOutputStream();
            ByteArrayOutputStream stderr = new ByteArrayOutputStream();
            // 异步收集 stdout 和 stderr，防止缓冲区满导致进程阻塞
            Thread outThread = collect(process.getInputStream(), stdout);
            Thread errThread = collect(process.getErrorStream(), stderr);
            boolean finished = process.waitFor(spec.timeoutSeconds(), TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                process.waitFor(3, TimeUnit.SECONDS); // 等待强制终止完成
            }
            outThread.join(Duration.ofSeconds(1));
            errThread.join(Duration.ofSeconds(1));
            String out = stdout.toString(StandardCharsets.UTF_8);
            String err = stderr.toString(StandardCharsets.UTF_8);
            if (!finished) {
                throw new PluginRuntimeException("External agent timed out after " + spec.timeoutSeconds() + "s");
            }
            if (process.exitValue() != 0) {
                throw new PluginRuntimeException("External agent failed: " + err);
            }
            // 从 stdout 中提取 <OCKB_JSON> 标签包裹的 JSON，stderr 作为警告
            return new AgentTaskResult(out, parseTaggedJson(out), err.isBlank() ? List.of() : List.of(err.strip()));
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new PluginRuntimeException("External agent interrupted", exception);
        } catch (IOException exception) {
            throw new PluginRuntimeException("External agent failed to start", exception);
        }
    }

    /** 创建守护线程异步读取子进程的输入流，防止进程因管道缓冲区满而挂起。 */
    private static Thread collect(java.io.InputStream input, ByteArrayOutputStream output) {
        Thread thread = new Thread(() -> {
            try (input) {
                input.transferTo(output);
            } catch (IOException ignored) {
            }
        });
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    /**
     * 组装外部 Agent 的完整 prompt。
     *
     * <p>在 system/user 提示词之后追加 JSON 输出格式约束，
     * 要求外部 Agent 使用 {@code <OCKB_JSON>} 标签包裹返回值。
     */
    private static String externalPrompt(AgentTask task) {
        return task.systemPrompt() + "\n\n" + task.userPrompt() + """

                After you finish modifying files, return only one JSON object wrapped by these exact markers:
                <OCKB_JSON>
                {"status":"SUCCESS","summary":"","changedFiles":[],"warnings":[]}
                </OCKB_JSON>
                Do not place Markdown fences around the JSON.
                """;
    }

    /**
     * 从外部 Agent 的标准输出中解析 {@code <OCKB_JSON>} 标签包裹的 JSON。
     *
     * <p>如果未找到标签标记，则尝试将整个输出作为 JSON 解析（兼容直接输出 JSON 的 Agent）。
     *
     * @param output 外部 Agent 的完整标准输出
     * @return 解析后的 JSON 对象
     * @throws PluginRuntimeException 输出不是合法 JSON 或不是 JSON 对象
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseTaggedJson(String output) {
        String begin = "<OCKB_JSON>";
        String end = "</OCKB_JSON>";
        int start = output.indexOf(begin);
        int stop = output.indexOf(end);
        // 优先提取标签内容，否则回退到完整输出
        String raw = start >= 0 && stop > start
                ? output.substring(start + begin.length(), stop).strip()
                : output.strip();
        try {
            Object parsed = PluginObjectMappers.DEFAULT.readValue(raw, Object.class);
            if (parsed instanceof Map<?, ?> map) {
                return (Map<String, Object>) map;
            }
            throw new PluginRuntimeException("External agent output must be a JSON object");
        } catch (IOException exception) {
            throw new PluginRuntimeException("External agent output is not valid JSON: " + exception.getMessage(), exception);
        }
    }
}
