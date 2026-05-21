package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.domain.DetectedDomain;
import org.team4u.actiondock.project.knowledge.plugin.domain.DetectedModule;
import org.team4u.actiondock.project.knowledge.plugin.domain.EvidenceExcerpt;
import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.PlannedTaskGroup;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryInventory;
import org.team4u.actiondock.project.knowledge.plugin.executor.AtomicTaskExecutor;
import org.team4u.actiondock.project.knowledge.plugin.template.TemplateService;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.FileVisitOption;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 仓库扫描器。
 *
 * <p>先递归收集 inventory，再交给 AI 判定项目形态、技术栈、知识域和任务分组。
 */
public class RepositoryScanner {
    private static final int MAX_SIGNALS = 300;
    private static final int MAX_READ_LINES = 120;
    private static final int MAX_READ_BYTES = 8 * 1024;
    private static final List<String> IGNORE_DIRS = List.of(".git", "node_modules", "target", "build", "dist", ".idea", KnowledgeConstants.WORKSPACE_DIR);
    private static final Map<String, String> SIGNAL_STACKS = Map.ofEntries(
            Map.entry("pom.xml", "java"),
            Map.entry("build.gradle", "java"),
            Map.entry("build.gradle.kts", "java"),
            Map.entry("settings.gradle", "java"),
            Map.entry("settings.gradle.kts", "java"),
            Map.entry("package.json", "node"),
            Map.entry("pnpm-workspace.yaml", "node"),
            Map.entry("yarn.lock", "node"),
            Map.entry("go.mod", "go"),
            Map.entry("Cargo.toml", "rust"),
            Map.entry("pyproject.toml", "python"),
            Map.entry("requirements.txt", "python"),
            Map.entry("Dockerfile", "ops")
    );

    private final TemplateService templateService;

    public RepositoryScanner(TemplateService templateService) {
        this.templateService = templateService;
    }

    public RepositoryFacts scan(ScriptPluginContext context,
                                MaintenanceRequest request,
                                AtomicTaskExecutor executor) throws IOException {
        RepositoryInventory inventory = collectInventory(request);
        Map<String, Object> classified = executor.scanRepository(context, request, inventory, scanPrompt(inventory));
        return toFacts(inventory, classified);
    }

    public RepositoryInventory collectInventory(MaintenanceRequest request) throws IOException {
        Path root = request.repoPath();
        if (!Files.exists(root)) {
            throw new PluginRuntimeException("repoPath does not exist: " + root);
        }
        if (!Files.isDirectory(root)) {
            throw new PluginRuntimeException("repoPath must be a directory: " + root);
        }

        List<Path> files = collectFiles(root);
        List<String> signals = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        for (Path file : files) {
            String rel = relative(root, file);
            String name = file.getFileName().toString();
            if (name.startsWith("README")) {
                signals.add("readme:" + rel);
            } else if (isMigrationDir(root, file)) {
                signals.add("database:" + rel);
            } else if (KnowledgeConstants.ENTRY_PATH.equals(rel)) {
                signals.add("actiondock-entry:" + rel);
            } else if (SIGNAL_STACKS.containsKey(name)) {
                signals.add(signalLabel(name) + ":" + rel);
            }
            if (signals.size() >= MAX_SIGNALS) {
                break;
            }
        }
        if (!Files.exists(root.resolve(KnowledgeConstants.ENTRY_PATH))) {
            warnings.add("ACTIONDOCK.md is missing and will be initialized.");
        }

        List<DetectedModule> modules = detectModules(root, files);
        List<EvidenceExcerpt> evidenceContents = new ArrayList<>();
        for (String evidenceFile : request.evidenceFiles()) {
            Path path = root.resolve(evidenceFile).normalize();
            if (!path.startsWith(root)) {
                warnings.add("Evidence file is outside repository root: " + evidenceFile);
                continue;
            }
            if (!Files.exists(path) || Files.isDirectory(path)) {
                warnings.add("Evidence file not found: " + evidenceFile);
                continue;
            }
            signals.add("evidence:" + evidenceFile);
            evidenceContents.add(new EvidenceExcerpt(evidenceFile, readExcerpt(path)));
        }

        return new RepositoryInventory(
                root,
                distinct(signals),
                directorySnapshot(root, files),
                modules,
                firstReadme(root, files),
                evidenceContents,
                warnings
        );
    }

    @SuppressWarnings("unchecked")
    private RepositoryFacts toFacts(RepositoryInventory inventory, Map<String, Object> classified) {
        String summary = requiredStringValue(classified, "scanSummary");
        String projectShape = requiredStringValue(classified, "projectShape");
        List<String> detectedStacks = stringList(classified.get("detectedStacks"));
        List<DetectedModule> modules = toModules(classified.get("modules"), inventory.modules());
        List<DetectedDomain> domains = toDomains(classified.get("domains"));
        List<PlannedTaskGroup> taskGroups = toTaskGroups(classified.get("taskGroups"));
        List<String> scanWarnings = mergeWarnings(inventory.scanWarnings(), stringList(classified.get("scanWarnings")));

        if (domains.isEmpty()) {
            throw new PluginRuntimeException("Repository scan returned no domains.");
        }
        if (taskGroups.isEmpty()) {
            throw new PluginRuntimeException("Repository scan returned no task groups.");
        }

        return new RepositoryFacts(
                inventory.root(),
                summary,
                projectShape,
                distinct(detectedStacks),
                modules,
                domains,
                taskGroups,
                inventory.inventorySignals(),
                scanWarnings,
                inventory.evidenceContents().stream().map(EvidenceExcerpt::path).toList()
        );
    }

    private List<Path> collectFiles(Path root) throws IOException {
        List<Path> files = new ArrayList<>();
        Files.walkFileTree(root, EnumSet.noneOf(FileVisitOption.class), Integer.MAX_VALUE, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                if (!dir.equals(root) && IGNORE_DIRS.contains(dir.getFileName().toString())) {
                    return FileVisitResult.SKIP_SUBTREE;
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                files.add(file);
                return FileVisitResult.CONTINUE;
            }
        });
        files.sort(Comparator.comparing(path -> relative(root, path)));
        return files;
    }

    private List<String> directorySnapshot(Path root, List<Path> files) {
        List<String> snapshot = new ArrayList<>();
        for (Path file : files) {
            String rel = relative(root, file);
            if (depth(rel) <= 3) {
                snapshot.add(rel);
            }
            if (snapshot.size() >= MAX_SIGNALS) {
                break;
            }
        }
        return snapshot;
    }

    private List<DetectedModule> detectModules(Path root, List<Path> files) {
        Map<String, ModuleAccumulator> modules = new LinkedHashMap<>();
        for (Path file : files) {
            String rel = relative(root, file);
            String name = file.getFileName().toString();
            if (!SIGNAL_STACKS.containsKey(name) && !name.startsWith("README")) {
                continue;
            }
            String modulePath = ".".equals(parent(rel)) ? "." : parent(rel);
            ModuleAccumulator module = modules.computeIfAbsent(modulePath, ModuleAccumulator::new);
            if (SIGNAL_STACKS.containsKey(name)) {
                module.stacks.add(SIGNAL_STACKS.get(name));
            }
            module.evidence.add(rel);
            module.role = inferRole(modulePath, module.stacks);
        }
        return modules.values().stream()
                .map(ModuleAccumulator::toModule)
                .sorted(Comparator.comparing(DetectedModule::path))
                .toList();
    }

    private String firstReadme(Path root, List<Path> files) throws IOException {
        for (Path file : files) {
            if (file.getFileName().toString().startsWith("README")) {
                return readExcerpt(file);
            }
        }
        return "";
    }

    private String readExcerpt(Path path) throws IOException {
        byte[] bytes = Files.readAllBytes(path);
        if (bytes.length > MAX_READ_BYTES) {
            bytes = java.util.Arrays.copyOf(bytes, MAX_READ_BYTES);
        }
        List<String> lines = new String(bytes, StandardCharsets.UTF_8).lines().limit(MAX_READ_LINES).toList();
        return String.join("\n", lines);
    }

    private String scanPrompt(RepositoryInventory inventory) {
        String template = templateService.load("scan-domains.md");
        return """
                %s

                Analyze this repository inventory and return JSON only with fields:
                - scanSummary: string
                - projectShape: single-service|multi-module|monorepo|library|mixed
                - detectedStacks: string[]
                - modules: [{path, role, stacks, evidence}]
                - domains: [{id, priority, reason, evidence}]
                - taskGroups: [{id, title, templateName, domains, evidence}]
                - scanWarnings: string[]

                Constraints:
                - domains.id must be from %s
                - taskGroups.id must be from %s
                - taskGroups.templateName must match the task group id:
                  common->template-common.md
                  flows->template-flows.md
                  data->template-data.md
                  integrations->template-integrations.md
                  ops->template-ops.md
                  diagnosis->template-diagnosis.md
                  security->template-security.md
                  agent->template-agent.md
                - Do not invent evidence paths.

                Repository root: %s
                Inventory signals:
                %s

                Directory snapshot:
                %s

                Rule-derived modules:
                %s

                README excerpt:
                %s

                Evidence excerpts:
                %s
                """.formatted(
                template,
                KnowledgeConstants.SUPPORTED_DOMAIN_IDS,
                KnowledgeConstants.SUPPORTED_TASK_GROUP_IDS,
                inventory.root(),
                inventory.inventorySignals(),
                inventory.directorySnapshot(),
                inventory.modules(),
                emptyIfBlank(inventory.readmeExcerpt()),
                inventory.evidenceContents()
        );
    }

    private static String requiredStringValue(Map<String, Object> values, String key) {
        Object value = values.get(key);
        if (!(value instanceof String string) || string.isBlank()) {
            throw new PluginRuntimeException("Repository scan is missing required field: " + key);
        }
        return string;
    }

    private static List<DetectedModule> toModules(Object value, List<DetectedModule> fallback) {
        if (!(value instanceof List<?> list) || list.isEmpty()) {
            return fallback;
        }
        List<DetectedModule> result = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) {
                throw new PluginRuntimeException("Repository scan modules must be JSON objects.");
            }
            result.add(new DetectedModule(
                    requiredString(map, "path"),
                    requiredString(map, "role"),
                    stringList(map.get("stacks")),
                    stringList(map.get("evidence"))
            ));
        }
        return result;
    }

    private static List<DetectedDomain> toDomains(Object value) {
        if (!(value instanceof List<?> list)) {
            throw new PluginRuntimeException("Repository scan domains must be an array.");
        }
        List<DetectedDomain> result = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) {
                throw new PluginRuntimeException("Repository scan domains must contain JSON objects.");
            }
            String id = requiredString(map, "id");
            if (!KnowledgeConstants.SUPPORTED_DOMAIN_IDS.contains(id)) {
                throw new PluginRuntimeException("Unsupported domain id from repository scan: " + id);
            }
            result.add(new DetectedDomain(
                    id,
                    requiredString(map, "priority"),
                    requiredString(map, "reason"),
                    stringList(map.get("evidence"))
            ));
        }
        return result;
    }

    private static List<PlannedTaskGroup> toTaskGroups(Object value) {
        if (!(value instanceof List<?> list)) {
            throw new PluginRuntimeException("Repository scan taskGroups must be an array.");
        }
        List<PlannedTaskGroup> result = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) {
                throw new PluginRuntimeException("Repository scan taskGroups must contain JSON objects.");
            }
            String id = requiredString(map, "id");
            if (!KnowledgeConstants.SUPPORTED_TASK_GROUP_IDS.contains(id)) {
                throw new PluginRuntimeException("Unsupported task group id from repository scan: " + id);
            }
            String templateName = requiredString(map, "templateName");
            if (!templateNameFor(id).equals(templateName)) {
                throw new PluginRuntimeException("Task group template mismatch for " + id + ": " + templateName);
            }
            result.add(new PlannedTaskGroup(
                    id,
                    requiredString(map, "title"),
                    templateName,
                    stringList(map.get("domains")),
                    stringList(map.get("evidence"))
            ));
        }
        return result;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().filter(String.class::isInstance).map(String.class::cast).toList();
    }

    private static String requiredString(Map<?, ?> values, String key) {
        Object value = values.get(key);
        if (!(value instanceof String string) || string.isBlank()) {
            throw new PluginRuntimeException("Repository scan item is missing required field: " + key);
        }
        return string;
    }

    private static List<String> mergeWarnings(List<String> inventoryWarnings, List<String> scanWarnings) {
        List<String> merged = new ArrayList<>(inventoryWarnings);
        merged.addAll(scanWarnings);
        return distinct(merged);
    }

    private static String templateNameFor(String id) {
        return switch (id) {
            case "common" -> "template-common.md";
            case "flows" -> "template-flows.md";
            case "data" -> "template-data.md";
            case "integrations" -> "template-integrations.md";
            case "ops" -> "template-ops.md";
            case "diagnosis" -> "template-diagnosis.md";
            case "security" -> KnowledgeConstants.TEMPLATE_SECURITY;
            case "agent" -> "template-agent.md";
            default -> throw new PluginRuntimeException("Unsupported task group id: " + id);
        };
    }

    private static boolean isMigrationDir(Path root, Path file) {
        String rel = relative(root, file);
        String lower = rel.toLowerCase(Locale.ROOT);
        return lower.contains("/db/migration/") || lower.endsWith("/db/migration")
                || lower.contains("/migrations/") || lower.endsWith("/migrations");
    }

    private static String signalLabel(String fileName) {
        return switch (fileName) {
            case "pom.xml" -> "java-maven";
            case "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts" -> "java-gradle";
            case "package.json", "pnpm-workspace.yaml", "yarn.lock" -> "node";
            case "go.mod" -> "go";
            case "Cargo.toml" -> "rust";
            case "pyproject.toml", "requirements.txt" -> "python";
            case "Dockerfile" -> "docker";
            default -> "signal";
        };
    }

    private static String inferRole(String modulePath, Set<String> stacks) {
        if (modulePath.equals(".")) {
            return "root";
        }
        if (stacks.contains("node") && modulePath.contains("admin")) {
            return "frontend";
        }
        if (stacks.contains("go")) {
            return "service";
        }
        if (stacks.contains("java")) {
            return "service";
        }
        return "module";
    }

    private static int depth(String rel) {
        return rel.isBlank() ? 0 : rel.split("/").length;
    }

    private static String parent(String rel) {
        int index = rel.lastIndexOf('/');
        return index < 0 ? "." : rel.substring(0, index);
    }

    private static String relative(Path root, Path path) {
        return root.relativize(path).toString().replace('\\', '/');
    }

    private static String emptyIfBlank(String value) {
        return value == null || value.isBlank() ? "(none)" : value;
    }

    private static List<String> distinct(List<String> values) {
        return new ArrayList<>(new LinkedHashSet<>(values));
    }

    private static final class ModuleAccumulator {
        private final String path;
        private final Set<String> stacks = new LinkedHashSet<>();
        private final List<String> evidence = new ArrayList<>();
        private String role = "module";

        private ModuleAccumulator(String path) {
            this.path = path;
        }

        private DetectedModule toModule() {
            return new DetectedModule(path, role, new ArrayList<>(stacks), distinct(evidence));
        }
    }
}
