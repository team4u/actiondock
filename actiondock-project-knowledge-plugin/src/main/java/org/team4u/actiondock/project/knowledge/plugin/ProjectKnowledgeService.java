package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

/**
 * OCKB 项目知识库编排服务。
 *
 * <p>核心编排流程：Chief Architect 划分 phase → Domain Planner 生成原子任务 →
 * Specialized Worker 并发执行 UPSERT/PRUNE → 入口文档与 SUMMARY 汇总 → 质量门校验。
 * 具体勘探和写盘由 internal 或 external-cli Agent 完成，runner 由调用方通过 {@link KnowledgeRequest} 传入。
 *
 * <p>所有 init/refresh/ingest 操作均为异步执行，通过虚拟线程池调度，
 * 任务状态持久化到 {@code .actiondock/project-knowledge/runs/} 目录。
 */
public class ProjectKnowledgeService {

    /** 单个 Worker 任务最大重试次数，超过后记录到 ERRORS.md。 */
    private static final int MAX_WORKER_RETRIES = 3;

    private final AgentRunners agentRunners;

    /** 文档质量校验器，在流水线完成后执行门禁检查。 */
    private final KnowledgeValidator validator = new KnowledgeValidator();

    /** 虚拟线程池，用于异步执行流水线以及并发调度 Worker 任务。 */
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public ProjectKnowledgeService(AiAgentRuntime runtime) {
        this.agentRunners = new AgentRunners(runtime);
    }

    /** 初始化 OCKB 知识库（异步），覆盖全部七大基座领域。 */
    public Map<String, Object> init(ScriptPluginContext context, Map<String, Object> values) {
        return submit(context, KnowledgeRequests.init(values));
    }

    /** 增量刷新知识库（异步），仅处理变更涉及的领域。 */
    public Map<String, Object> refresh(ScriptPluginContext context, Map<String, Object> values) {
        return submit(context, KnowledgeRequests.refresh(values));
    }

    /** 导入手工资料（异步），激活 Triage Planner 进行资料整理。 */
    public Map<String, Object> ingest(ScriptPluginContext context, Map<String, Object> values) {
        return submit(context, KnowledgeRequests.ingest(values));
    }

    /**
     * 提交异步任务：生成 runId、创建快照、提交到虚拟线程池执行。
     *
     * <p>调用方立即获得 {@code {runId, status: "ACCEPTED"}} 响应，实际流水线在后台执行。
     * 任务状态通过 {@link KnowledgeAsyncRunStore} 持久化，支持 getRun/cancelRun 查询。
     */
    private Map<String, Object> submit(ScriptPluginContext context, KnowledgeRequest request) {
        String runId = request.mode() + "-" + UUID.randomUUID().toString().substring(0, 8);
        KnowledgeAsyncRunStore asyncStore = new KnowledgeAsyncRunStore(request.repoPath());
        KnowledgeRunSnapshot snapshot = asyncStore.create(runId, request.mode());
        executor.submit(() -> {
            try {
                Map<String, Object> result = runPipeline(context, request, runId);
                if (!asyncStore.cancelled(runId)) {
                    asyncStore.success(snapshot, result);
                }
            } catch (Exception exception) {
                if (!asyncStore.cancelled(runId)) {
                    asyncStore.failed(snapshot, exception.getMessage() == null ? exception.getClass().getName() : exception.getMessage());
                }
            }
        });
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("status", "ACCEPTED");
        result.put("repoPath", request.repoPath().toString());
        return result;
    }

    /**
     * 同步执行完整知识库生成流水线。
     *
     * <p>流程：校验仓库 → 确保目录结构 → 勘探仓库信息 → Chief 规划 phase →
     * 逐 phase 执行 Planner + Worker → 汇总入口文档 → 质量门校验。
     *
     * @return 包含 status（SUCCESS/NEEDS_REVIEW）、phases、changedFiles、warnings、qualityGate 的结果
     */
    private Map<String, Object> runPipeline(ScriptPluginContext context, KnowledgeRequest request, String runId) throws IOException {
        if (!Files.isDirectory(request.repoPath())) {
            throw new PluginRuntimeException("repoPath must be a directory: " + request.repoPath());
        }
        ensureBaseStructure(request.repoPath());
        if (!"init".equals(request.mode())) {
            requireInitialized(request.repoPath());
        }

        // 根据请求配置选择 Agent 执行器（内置 / 外部 CLI）
        AgentRunner runner = agentRunners.resolve(request);
        // 勘探仓库：收集目录树、变更文件、inbox 等上下文信息供 Agent 使用
        Map<String, Object> input = inspect(request);
        // Chief Architect 规划执行阶段，若无有效输出则使用确定性回退方案
        List<KnowledgePhase> phases = planPhases(context, runner, request, runId, input);
        List<Map<String, Object>> phaseSummaries = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        List<String> changedFiles = new ArrayList<>();

        for (KnowledgePhase phase : phases) {
            List<KnowledgeWorkerTask> tasks = new ArrayList<>();
            // 逐领域调用 Planner 生成原子文档任务
            for (String domain : phase.domainsToActivate()) {
                AgentTaskResult plannerResult = runner.run(context, request, plannerTask(request, runId, phase, domain, input));
                warnings.addAll(plannerResult.warnings());
                tasks.addAll(parsePlannerTasks(plannerResult.json(), domain));
            }
            // 去重 + 安全校验（防止路径穿越和通配符注入）
            List<KnowledgeWorkerTask> safeTasks = uniqueSafeTasks(tasks);
            // 并发执行 Worker 任务，每个任务支持失败重试
            List<KnowledgeWorkerResult> workerResults = runWorkers(context, runner, request, runId, phase, safeTasks, warnings);
            for (KnowledgeWorkerResult result : workerResults) {
                if (result.changedFiles() != null) {
                    changedFiles.addAll(result.changedFiles());
                }
                if (result.warnings() != null) {
                    warnings.addAll(result.warnings());
                }
            }
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("phaseNum", phase.phaseNum());
            summary.put("domains", phase.domainsToActivate());
            summary.put("tasks", safeTasks.size());
            summary.put("completed", workerResults.stream().filter(item -> "COMPLETED".equals(item.status())).count());
            phaseSummaries.add(summary);
        }

        // 生成/更新 ACTIONDOCK.md 入口和 SUMMARY.md 目录索引
        finalizeEntryDocuments(request.repoPath());
        KnowledgeValidator.MapValidation validation = validator.validate(request.repoPath());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("repoPath", request.repoPath().toString());
        result.put("mode", request.mode());
        result.put("runId", runId);
        result.put("status", validation.ok() ? "SUCCESS" : "NEEDS_REVIEW");
        result.put("phases", phaseSummaries);
        result.put("changedFiles", changedFiles.stream().distinct().toList());
        result.put("warnings", warnings.stream().filter(item -> item != null && !item.isBlank()).distinct().toList());
        result.put("qualityGate", qualityGate(validation));
        return result;
    }

    /** 检查仓库是否已初始化：必须存在 ACTIONDOCK.md 入口文件和 .knowledge_base 目录。 */
    private void requireInitialized(Path repoPath) {
        if (!Files.exists(repoPath.resolve(KnowledgeConstants.ACTIONDOCK_ENTRY))
                || !Files.isDirectory(repoPath.resolve(KnowledgeConstants.KNOWLEDGE_BASE_ROOT))) {
            throw new PluginRuntimeException("Knowledge base is not initialized. Run init first.");
        }
    }

    /** 确保七大基座目录和 .kb_inbox 收件箱目录存在。 */
    private void ensureBaseStructure(Path repoPath) throws IOException {
        for (String dir : pillarDirs()) {
            Files.createDirectories(repoPath.resolve(dir));
        }
        Files.createDirectories(repoPath.resolve(".kb_inbox"));
    }

    /**
     * 勘探仓库，收集 Agent 所需的上下文信息。
     *
     * <p>包括：仓库路径、模式、变更文件列表、知识库目录树、inbox 文件列表等。
     */
    private Map<String, Object> inspect(KnowledgeRequest request) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("repoPath", request.repoPath().toString());
        input.put("mode", request.mode());
        input.put("changedFiles", effectiveChangedFiles(request));
        input.put("sources", request.sources());
        input.put("evidenceFiles", request.evidenceFiles());
        input.put("kbDirectoryTree", directoryTree(request.repoPath().resolve(KnowledgeConstants.KNOWLEDGE_BASE_ROOT)));
        input.put("inboxFiles", directoryTree(request.repoPath().resolve(".kb_inbox")));
        input.put("pillarDirectories", pillarDirs());
        return input;
    }

    /**
     * 获取有效的变更文件列表。
     *
     * <p>优先级：请求参数指定的 changedFiles > git diff（非 init 模式） > init 模式默认种子文件。
     */
    private List<String> effectiveChangedFiles(KnowledgeRequest request) {
        if (!request.changedFiles().isEmpty()) {
            return request.changedFiles();
        }
        if ("init".equals(request.mode())) {
            return List.of("pom.xml", "package.json", "go.mod", "README.md", "src/", "db/", "scripts/", "Dockerfile", "docker-compose.yml");
        }
        List<String> git = gitChangedFiles(request.repoPath());
        return git.isEmpty() ? List.of() : git;
    }

    /** 通过 git diff 获取相对于 HEAD 的变更文件列表，排除构建产物和知识库自身文件。 */
    private List<String> gitChangedFiles(Path repoPath) {
        try {
            Process process = new ProcessBuilder("git", "diff", "--name-status", "--find-renames", "HEAD")
                    .directory(repoPath.toFile())
                    .redirectErrorStream(true)
                    .start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int exit = process.waitFor();
            if (exit != 0 || output.isBlank()) {
                return List.of();
            }
            return output.lines()
                    .map(String::strip)
                    .filter(line -> !line.isBlank())
                    .map(line -> line.split("\\s+"))
                    .map(parts -> parts.length == 0 ? "" : parts[parts.length - 1])
                    .filter(path -> !excludedChange(path))
                    .toList();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return List.of();
        } catch (IOException ignored) {
            return List.of();
        }
    }

    /** 判断变更文件是否应排除：排除知识库输出、工作区、构建产物和 node_modules。 */
    private boolean excludedChange(String path) {
        return path.startsWith(".knowledge_base/")
                || path.startsWith(".actiondock/")
                || path.startsWith("target/")
                || path.contains("/target/")
                || path.startsWith("node_modules/")
                || path.contains("/node_modules/")
                || path.startsWith("dist/")
                || path.contains("/dist/");
    }

    /**
     * 生成目录树列表，最多 4 层深度、最多 300 条。
     *
     * <p>路径统一使用正斜杠分隔符，用于向 Agent 展示现有知识库结构。
     */
    private List<String> directoryTree(Path root) {
        if (!Files.exists(root)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.walk(root, 4)) {
            return stream
                    .filter(path -> !path.equals(root))
                    .sorted()
                    .map(root::relativize)
                    .map(Path::toString)
                    .map(path -> path.replace('\\', '/'))
                    .limit(300)
                    .toList();
        } catch (IOException exception) {
            return List.of();
        }
    }

    /**
     * 调用 Chief Architect Agent 规划执行阶段。
     *
     * <p>若 AI 返回无效或空结果，使用 {@link #fallbackPhases} 确定性回退方案。
     */
    private List<KnowledgePhase> planPhases(ScriptPluginContext context,
                                            AgentRunner runner,
                                            KnowledgeRequest request,
                                            String runId,
                                            Map<String, Object> input) {
        AgentTaskResult result = runner.run(context, request, chiefTask(request, runId, input));
        List<KnowledgePhase> phases = parsePhases(result.json());
        return phases.isEmpty() ? fallbackPhases(request) : phases;
    }

    /** 构建 Chief Architect Agent 任务：根据仓库变更和知识库现状划分执行阶段。 */
    private AgentTask chiefTask(KnowledgeRequest request, String runId, Map<String, Object> input) {
        return new AgentTask(
                runId + "-chief",
                "chief-architect",
                """
                        你是 OCKB 知识库的全局首席架构师。插件负责流程编排，你只负责宏观分诊与 phase 定序。
                        你只能根据输入中的变更路径、知识库目录树和收件箱信息判断激活哪些 Planner。
                        不要读取具体代码，不要规划具体 Markdown 修改任务。
                        输出必须是 JSON object，格式为 {"phases":[{"phase_num":0,"domains_to_activate":["Data_Model_Planner"]}]}。
                        """,
                """
                        根据输入为本次 %s 运行划分 OCKB phases。
                        数据模型和基础设施类变更必须进入较早 phase；API 和业务流程依赖它们时放到后续 phase。
                        init 模式应覆盖全部 OCKB 领域；ingest 模式必须激活 Triage_Planner。
                        """.formatted(request.mode()),
                input
        );
    }

    /** 构建 Domain Planner Agent 任务：针对单个领域生成 UPSERT/PRUNE 原子任务列表。 */
    private AgentTask plannerTask(KnowledgeRequest request,
                                  String runId,
                                  KnowledgePhase phase,
                                  String domain,
                                  Map<String, Object> input) {
        Map<String, Object> plannerInput = new LinkedHashMap<>(input);
        plannerInput.put("phaseNum", phase.phaseNum());
        plannerInput.put("domain", domain);
        return new AgentTask(
                runId + "-phase-" + phase.phaseNum() + "-" + domain,
                "domain-planner",
                """
                        你是 OCKB 专属领域规划师。插件负责创建 Worker 和并发编排，你只输出本领域原子任务。
                        你可以通过 Shell 勘测本地代码库和对应 .knowledge_base 基座目录，判断文档需要 UPSERT 或 PRUNE。
                        输出必须是 JSON object，格式为 {"tasks":[{"action":"UPSERT","target_path":".knowledge_base/03_Data_Models/user_table.md","focus_code_entity":"src/main/java/User.java","clue":"..."}]}。
                        不要写文件，不要删除文件。
                        """,
                plannerPrompt(domain),
                plannerInput
        );
    }

    /** 生成 Planner 的用户提示词，约束输出格式和任务类型。 */
    private String plannerPrompt(String domain) {
        return """
                当前 Planner：%s。
                请只规划属于该领域的任务。target_path 必须位于 .knowledge_base/ 下的新 7 大目录内。
                删除类任务使用 PRUNE；创建或更新类任务使用 UPSERT。
                如果没有任务，返回 {"tasks":[]}。
                """.formatted(domain);
    }

    /**
     * 构建 Specialized Worker Agent 任务：执行单个文档的物理收敛。
     *
     * @param previousError 重试时传入的上次错误信息，首次执行为 null
     */
    private AgentTask workerTask(KnowledgeRequest request,
                                 String runId,
                                 KnowledgePhase phase,
                                 KnowledgeWorkerTask task,
                                 String previousError) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("repoPath", request.repoPath().toString());
        input.put("mode", request.mode());
        input.put("phaseNum", phase.phaseNum());
        input.put("action", task.action());
        input.put("targetPath", task.targetPath());
        input.put("focusCodeEntity", task.focusCodeEntity());
        input.put("clue", task.clue());
        input.put("previousError", previousError);
        return new AgentTask(
                runId + "-worker-" + phase.phaseNum() + "-" + safeTaskId(task.targetPath()),
                "specialized-worker",
                """
                        你是 OCKB Specialized Worker。插件已校验 target_path 安全性，你负责一个文件的物理收敛。
                        你拥有 Shell 能力，可以读取源码、读取前置 phase 已落盘文档，并写回目标 Markdown。
                        PRUNE 时只删除 targetPath。UPSERT 时先读取旧文档，结合代码证据更新或创建 Markdown。
                        如需画图，使用标准 Mermaid fenced block。
                        完成后只返回 JSON object：{"status":"COMPLETED","target_path":"...","changedFiles":["..."],"warnings":[]}。
                        """,
                """
                        执行动作：%s
                        目标路径：%s
                        代码入口：%s
                        线索：%s
                        上次错误：%s
                        """.formatted(task.action(), task.targetPath(), task.focusCodeEntity(), task.clue(), previousError == null ? "" : previousError),
                input
        );
    }

    /**
     * 解析 Chief Architect 返回的 phase 列表。
     *
     * <p>兼容下划线（phase_num / domains_to_activate）和驼峰（phaseNum / domainsToActivate）两种 JSON 键名。
     */
    @SuppressWarnings("unchecked")
    private List<KnowledgePhase> parsePhases(Map<String, Object> json) {
        Object raw = json.get("phases");
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<KnowledgePhase> phases = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                int phaseNum = intValue(map.get("phase_num"), intValue(map.get("phaseNum"), phases.size()));
                Object domainsRaw = map.get("domains_to_activate");
                if (domainsRaw == null) {
                    domainsRaw = map.get("domainsToActivate");
                }
                List<String> domains = stringList(domainsRaw);
                if (!domains.isEmpty()) {
                    phases.add(new KnowledgePhase(phaseNum, domains));
                }
            }
        }
        return phases.stream().sorted(Comparator.comparingInt(KnowledgePhase::phaseNum)).toList();
    }

    /**
     * 确定性回退方案：当 AI 未返回有效 phase 时使用。
     *
     * <p>init 模式覆盖全部七大领域，refresh/ingest 模式只处理相关子集。
     * 数据模型和基础设施类变更放在较早 phase，业务流程和 Agent 工具放后续 phase。
     */
    private List<KnowledgePhase> fallbackPhases(KnowledgeRequest request) {
        if ("ingest".equals(request.mode())) {
            return List.of(new KnowledgePhase(0, List.of("Triage_Planner")));
        }
        if ("init".equals(request.mode())) {
            return List.of(
                    new KnowledgePhase(0, List.of("Chief_Architect", "Data_Model_Planner", "Infra_Env_Planner", "Agent_Tool_Planner", "Triage_Planner")),
                    new KnowledgePhase(1, List.of("Business_Flow_Planner"))
            );
        }
        return List.of(
                new KnowledgePhase(0, List.of("Data_Model_Planner", "Infra_Env_Planner", "Triage_Planner")),
                new KnowledgePhase(1, List.of("Business_Flow_Planner", "Agent_Tool_Planner"))
        );
    }

    /**
     * 解析 Planner 返回的原子任务列表。
     *
     * <p>兼容下划线和驼峰两种 JSON 键名，自动归一化 target_path。
     */
    private List<KnowledgeWorkerTask> parsePlannerTasks(Map<String, Object> json, String planner) {
        Object raw = json.get("tasks");
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<KnowledgeWorkerTask> tasks = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                String action = string(map.get("action")).toUpperCase(Locale.ROOT);
                String target = firstString(map.get("target_path"), map.get("targetPath"));
                if (target == null || target.isBlank()) {
                    continue;
                }
                tasks.add(new KnowledgeWorkerTask(
                        action,
                        normalizeTargetPath(target),
                        firstString(map.get("focus_code_entity"), map.get("focusCodeEntity")),
                        string(map.get("clue")),
                        planner
                ));
            }
        }
        return tasks;
    }

    /**
     * 对任务列表去重并执行安全校验。
     *
     * <p>相同 target_path 的任务只保留第一个，防止并发写入冲突。
     */
    private List<KnowledgeWorkerTask> uniqueSafeTasks(List<KnowledgeWorkerTask> tasks) {
        Map<String, KnowledgeWorkerTask> byPath = new LinkedHashMap<>();
        for (KnowledgeWorkerTask task : tasks) {
            validateTask(task);
            byPath.putIfAbsent(task.targetPath(), task);
        }
        return new ArrayList<>(byPath.values());
    }

    /**
     * 校验单个 Worker 任务的安全性。
     *
     * <p>检查 action 必须为 UPSERT 或 PRUNE；target_path 必须相对、不含路径穿越、
     * 不含通配符、且必须位于 .knowledge_base/ 下。
     */
    private void validateTask(KnowledgeWorkerTask task) {
        if (!"UPSERT".equals(task.action()) && !"PRUNE".equals(task.action())) {
            throw new PluginRuntimeException("Unsupported OCKB worker action: " + task.action());
        }
        Path target = Path.of(task.targetPath());
        if (target.isAbsolute()
                || task.targetPath().contains("..")
                || task.targetPath().contains("*")
                || !task.targetPath().startsWith(KnowledgeConstants.KNOWLEDGE_BASE_ROOT + "/")) {
            throw new PluginRuntimeException("Unsafe OCKB target_path: " + task.targetPath());
        }
    }

    /**
     * 并发执行同一 phase 下的所有 Worker 任务。
     *
     * <p>每个任务通过 {@link #runWorkerWithRetries} 独立重试，
     * 整体通过 {@link ExecutorService#invokeAll} 并发调度。
     */
    private List<KnowledgeWorkerResult> runWorkers(ScriptPluginContext context,
                                                   AgentRunner runner,
                                                   KnowledgeRequest request,
                                                   String runId,
                                                   KnowledgePhase phase,
                                                   List<KnowledgeWorkerTask> tasks,
                                                   List<String> warnings) {
        List<Callable<KnowledgeWorkerResult>> calls = tasks.stream()
                .map(task -> (Callable<KnowledgeWorkerResult>) () -> runWorkerWithRetries(context, runner, request, runId, phase, task))
                .toList();
        try {
            List<Future<KnowledgeWorkerResult>> futures = executor.invokeAll(calls);
            List<KnowledgeWorkerResult> results = new ArrayList<>();
            for (Future<KnowledgeWorkerResult> future : futures) {
                results.add(future.get());
            }
            return results;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new PluginRuntimeException("OCKB worker phase interrupted", exception);
        } catch (Exception exception) {
            warnings.add(exception.getMessage());
            return List.of();
        }
    }

    /**
     * 带重试的 Worker 执行：最多重试 {@link #MAX_WORKER_RETRIES} 次。
     *
     * <p>重试时将上次错误信息注入 Agent 提示词，辅助 AI 修正输出。
     * 超过重试次数后将错误追加到 ERRORS.md 并返回 FAILED 状态。
     */
    private KnowledgeWorkerResult runWorkerWithRetries(ScriptPluginContext context,
                                                       AgentRunner runner,
                                                       KnowledgeRequest request,
                                                       String runId,
                                                       KnowledgePhase phase,
                                                       KnowledgeWorkerTask task) {
        String previousError = null;
        for (int attempt = 1; attempt <= MAX_WORKER_RETRIES; attempt++) {
            try {
                AgentTaskResult result = runner.run(context, request, workerTask(request, runId, phase, task, previousError));
                return parseWorkerResult(result.json(), task, result.warnings());
            } catch (Exception exception) {
                previousError = exception.getMessage() == null ? exception.getClass().getName() : exception.getMessage();
            }
        }
        appendError(request.repoPath(), task, previousError);
        return new KnowledgeWorkerResult("FAILED", task.targetPath(), List.of(), List.of(previousError), Map.of());
    }

    /** 解析 Worker Agent 的执行结果，合并 runner 级别和 Agent 级别的警告。 */
    private KnowledgeWorkerResult parseWorkerResult(Map<String, Object> json, KnowledgeWorkerTask task, List<String> runnerWarnings) {
        List<String> warnings = new ArrayList<>(runnerWarnings);
        warnings.addAll(stringList(json.get("warnings")));
        return new KnowledgeWorkerResult(
                firstString(json.get("status"), "COMPLETED"),
                firstString(json.get("target_path"), json.get("targetPath"), task.targetPath()),
                stringList(json.get("changedFiles")),
                warnings,
                json
        );
    }

    /** 将 Worker 执行失败信息追加到 ERRORS.md 日志文件。 */
    private void appendError(Path repoPath, KnowledgeWorkerTask task, String error) {
        try {
            Path path = repoPath.resolve(KnowledgeConstants.ERRORS_PATH);
            Files.createDirectories(path.getParent());
            String block = """

                    ## %s

                    - target_path: `%s`
                    - action: `%s`
                    - planner: `%s`
                    - clue: %s
                    - error: %s
                    """.formatted(Instant.now(), task.targetPath(), task.action(), task.planner(), task.clue(), error);
            Files.writeString(path, block, StandardCharsets.UTF_8,
                    Files.exists(path) ? java.nio.file.StandardOpenOption.APPEND : java.nio.file.StandardOpenOption.CREATE);
        } catch (IOException exception) {
            throw new PluginRuntimeException("Cannot write OCKB error log", exception);
        }
    }

    /**
     * 生成/更新入口文档和目录索引。
     *
     * <p>ACTIONDOCK.md 不存在时创建默认入口；SUMMARY.md 始终根据实际文件重新生成。
     */
    private void finalizeEntryDocuments(Path repoPath) throws IOException {
        Path actiondock = repoPath.resolve(KnowledgeConstants.ACTIONDOCK_ENTRY);
        if (!Files.exists(actiondock)) {
            Files.writeString(actiondock, """
                    # 项目知识库

                    ## 阅读路径

                    - 知识库索引：`.knowledge_base/SUMMARY.md`
                    - 架构总览：`.knowledge_base/01_Architecture_Overview/`
                    - API 契约：`.knowledge_base/02_API_Specifications/`
                    - 数据模型：`.knowledge_base/03_Data_Models/`
                    - 业务流程：`.knowledge_base/04_Business_Flows/`
                    - Agent 工具与 CLI：`.knowledge_base/05_Agent_Tools_and_CLI/`
                    - 基础设施与环境：`.knowledge_base/06_Infra_and_Env/`
                    - 维护与运维：`.knowledge_base/07_Maintenance_and_Ops/`
                    """, StandardCharsets.UTF_8);
        }
        Path summary = repoPath.resolve(KnowledgeConstants.SUMMARY_PATH);
        Files.createDirectories(summary.getParent());
        Files.writeString(summary, summaryContent(repoPath), StandardCharsets.UTF_8);
    }

    /** 扫描七大基座目录生成 SUMMARY.md 内容，列出所有已发布的 Markdown 文档。 */
    private String summaryContent(Path repoPath) {
        StringBuilder builder = new StringBuilder("# OCKB 全景知识库目录\n\n");
        for (String dir : pillarDirs()) {
            builder.append("- `").append(dir).append("`\n");
            Path absolute = repoPath.resolve(dir);
            for (String file : markdownFiles(absolute)) {
                builder.append("  - [").append(file).append("](")
                        .append(dir.substring((KnowledgeConstants.KNOWLEDGE_BASE_ROOT + "/").length()))
                        .append("/").append(file).append(")\n");
            }
        }
        return builder.toString();
    }

    private List<String> markdownFiles(Path dir) {
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.list(dir)) {
            return stream
                    .filter(path -> Files.isRegularFile(path) && path.getFileName().toString().endsWith(".md"))
                    .map(path -> path.getFileName().toString())
                    .sorted()
                    .toList();
        } catch (IOException exception) {
            return List.of();
        }
    }

    /** 同步校验知识库文档质量，返回质量门结果。 */
    public Map<String, Object> validate(Map<String, Object> values) throws IOException {
        Path repoPath = KnowledgeRequests.validate(values);
        KnowledgeValidator.MapValidation validation = validator.validate(repoPath);
        return qualityGate(validation);
    }

    /** 查询异步任务的执行状态和结果。 */
    public Map<String, Object> getRun(Map<String, Object> values) {
        Path repoPath = KnowledgeRequests.validate(values);
        String runId = String.valueOf(values.get("runId"));
        if (runId == null || runId.isBlank() || "null".equals(runId)) {
            throw new PluginRuntimeException("runId is required");
        }
        KnowledgeRunSnapshot snapshot = new KnowledgeAsyncRunStore(repoPath).load(runId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", snapshot.runId());
        result.put("mode", snapshot.mode());
        result.put("status", snapshot.status());
        result.put("repoPath", snapshot.repoPath());
        result.put("startedAt", snapshot.startedAt());
        result.put("finishedAt", snapshot.finishedAt());
        result.put("result", snapshot.result());
        result.put("errorMessage", snapshot.errorMessage());
        return result;
    }

    /** 取消正在执行的异步任务，标记状态为 CANCELLED。 */
    public Map<String, Object> cancelRun(Map<String, Object> values) {
        Path repoPath = KnowledgeRequests.validate(values);
        String runId = String.valueOf(values.get("runId"));
        if (runId == null || runId.isBlank() || "null".equals(runId)) {
            throw new PluginRuntimeException("runId is required");
        }
        KnowledgeAsyncRunStore store = new KnowledgeAsyncRunStore(repoPath);
        KnowledgeRunSnapshot snapshot = store.load(runId);
        store.cancelled(snapshot);
        return Map.of("runId", runId, "status", "CANCELLED");
    }

    /** 将校验结果转换为质量门响应格式，包含 ok 标志和问题详情列表。 */
    private Map<String, Object> qualityGate(KnowledgeValidator.MapValidation validation) {
        Map<String, Object> gate = new LinkedHashMap<>();
        gate.put("ok", validation.ok());
        gate.put("issues", validation.issues().stream().map(issue -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("code", issue.code());
            map.put("path", issue.path());
            map.put("message", issue.message());
            map.put("documentId", issue.documentId());
            map.put("repairable", issue.repairable());
            return map;
        }).toList());
        return gate;
    }

    /** 返回 OCKB 七大基座目录的相对路径列表。 */
    private List<String> pillarDirs() {
        return List.of(
                KnowledgeConstants.ARCHITECTURE_DIR,
                KnowledgeConstants.API_DIR,
                KnowledgeConstants.DATA_DIR,
                KnowledgeConstants.FLOWS_DIR,
                KnowledgeConstants.AGENT_TOOLS_DIR,
                KnowledgeConstants.INFRA_ENV_DIR,
                KnowledgeConstants.MAINTENANCE_OPS_DIR
        );
    }

    /**
     * 归一化 target_path：统一正斜杠、去除前缀 {@code ./}、确保以 .knowledge_base/ 开头。
     */
    private String normalizeTargetPath(String path) {
        String normalized = path.replace('\\', '/');
        while (normalized.startsWith("./")) {
            normalized = normalized.substring(2);
        }
        if (!normalized.startsWith(KnowledgeConstants.KNOWLEDGE_BASE_ROOT + "/")) {
            normalized = KnowledgeConstants.KNOWLEDGE_BASE_ROOT + "/" + normalized;
        }
        return normalized;
    }

    /** 将文件路径转换为安全的 taskId（仅保留字母数字，用连字符连接）。 */
    private String safeTaskId(String value) {
        return value.replaceAll("[^A-Za-z0-9]+", "-");
    }

    private String string(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String firstString(Object... values) {
        for (Object value : values) {
            if (value != null && !String.valueOf(value).isBlank()) {
                return String.valueOf(value);
            }
        }
        return "";
    }

    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().filter(item -> item != null && !String.valueOf(item).isBlank()).map(String::valueOf).toList();
    }

    private int intValue(Object value, int defaultValue) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value != null) {
            try {
                return Integer.parseInt(String.valueOf(value));
            } catch (NumberFormatException ignored) {
            }
        }
        return defaultValue;
    }
}
