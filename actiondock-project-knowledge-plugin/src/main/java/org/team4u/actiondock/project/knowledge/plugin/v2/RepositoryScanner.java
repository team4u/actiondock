package org.team4u.actiondock.project.knowledge.plugin.v2;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 仓库文件扫描器。
 *
 * <p>遍历仓库目录树，收集有价值的证据文件，检测技术栈，提取业务入口、SQL 表名和运维文件。
 * 忽略常见的构建输出和依赖目录（.git、node_modules、target 等）。
 */
final class RepositoryScanner {

    /** 扫描时跳过的目录名称集合 */
    private static final Set<String> IGNORE_DIRS = Set.of(".git", "node_modules", "target", "dist", "build", ".idea", ".actiondock");

    /** 匹配 CREATE TABLE 语句中的表名 */
    private static final Pattern CREATE_TABLE = Pattern.compile("create\\s+table\\s+([`\\\"]?)([a-zA-Z0-9_.-]+)\\1", Pattern.CASE_INSENSITIVE);

    /** 证据文件内容截取的最大字节数（6KB） */
    private static final int MAX_SNIPPET_BYTES = 6 * 1024;

    /** README 文件最大读取行数 */
    private static final int MAX_README_LINES = 80;

    /**
     * 扫描仓库并返回结构化的扫描结果。
     *
     * <p>扫描流程：收集文件 → 检测技术栈 → 收集证据 → 分类索引 → 生成摘要。
     */
    ScanResult scan(KnowledgeRequest request) throws IOException {
        Path root = request.repoPath();
        if (!Files.isDirectory(root)) {
            throw new PluginRuntimeException("repoPath must be a directory: " + root);
        }
        List<Path> files = collectFiles(root);
        List<String> warnings = new ArrayList<>();
        List<String> stacks = detectStacks(files);
        List<EvidenceRecord> evidence = collectEvidence(root, files, request.evidenceFiles(), warnings);
        LinkedHashSet<String> flowPaths = new LinkedHashSet<>();
        LinkedHashSet<String> sqlPaths = new LinkedHashSet<>();
        LinkedHashSet<String> operationPaths = new LinkedHashSet<>();
        LinkedHashSet<String> tableNames = new LinkedHashSet<>();
        for (EvidenceRecord record : evidence) {
            String lower = record.path().toLowerCase(Locale.ROOT);
            if (isFlow(lower)) {
                flowPaths.add(record.path());
            }
            if (lower.endsWith(".sql")) {
                sqlPaths.add(record.path());
                Matcher matcher = CREATE_TABLE.matcher(record.snippet());
                while (matcher.find()) {
                    tableNames.add(matcher.group(2));
                }
            }
            if (isOperational(lower)) {
                operationPaths.add(record.path());
            }
        }
        String projectName = root.getFileName() == null ? root.toString() : root.getFileName().toString();
        String readme = firstReadme(root, files);
        String summary = deterministicSummary(projectName, stacks, flowPaths, tableNames);
        return new ScanResult(
                root,
                projectName,
                summary,
                readme,
                stacks,
                evidence,
                List.copyOf(flowPaths),
                List.copyOf(tableNames),
                List.copyOf(sqlPaths),
                List.copyOf(operationPaths),
                List.copyOf(warnings)
        );
    }

    /** 遍历仓库目录树，跳过忽略目录，返回排序后的所有文件路径。 */
    private List<Path> collectFiles(Path root) throws IOException {
        List<Path> files = new ArrayList<>();
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
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

    /** 根据特征文件名（pom.xml、package.json、go.mod 等）检测项目技术栈。 */
    private List<String> detectStacks(List<Path> files) {
        LinkedHashSet<String> stacks = new LinkedHashSet<>();
        for (Path file : files) {
            String name = file.getFileName().toString();
            switch (name) {
                case "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts" -> stacks.add("java");
                case "package.json", "pnpm-workspace.yaml", "yarn.lock" -> stacks.add("node");
                case "go.mod" -> stacks.add("go");
                case "pyproject.toml", "requirements.txt" -> stacks.add("python");
                case "Cargo.toml" -> stacks.add("rust");
                case "Dockerfile", "docker-compose.yml", "docker-compose.yaml" -> stacks.add("ops");
                default -> {
                }
            }
        }
        return List.copyOf(stacks);
    }

    /**
     * 收集证据记录：从仓库文件中筛选有价值的文件，并附加用户指定的额外证据文件。
     * 内部证据编号为 ev-N，用户指定证据编号为 ext-N。
     */
    private List<EvidenceRecord> collectEvidence(Path root, List<Path> files, List<String> evidenceFiles, List<String> warnings) throws IOException {
        List<EvidenceRecord> evidence = new ArrayList<>();
        int counter = 1;
        for (Path file : files) {
            String rel = relative(root, file);
            if (!interesting(rel, file.getFileName().toString())) {
                continue;
            }
            evidence.add(new EvidenceRecord(
                    "ev-" + counter++,
                    rel,
                    classify(rel),
                    readSnippet(file),
                    fingerprint(List.of(rel, readSnippet(file)))
            ));
        }
        for (String evidenceFile : evidenceFiles) {
            Path path = root.resolve(evidenceFile).normalize();
            if (!path.startsWith(root) || !Files.exists(path) || Files.isDirectory(path)) {
                warnings.add("Invalid evidence file: " + evidenceFile);
                continue;
            }
            String rel = relative(root, path);
            evidence.add(new EvidenceRecord(
                    "ext-" + counter++,
                    rel,
                    "external",
                    readSnippet(path),
                    fingerprint(List.of(rel, readSnippet(path)))
            ));
        }
        return evidence;
    }

    private String firstReadme(Path root, List<Path> files) throws IOException {
        for (Path file : files) {
            if (file.getFileName().toString().startsWith("README")) {
                return Files.readString(file, StandardCharsets.UTF_8).lines()
                        .limit(MAX_README_LINES)
                        .reduce("", (left, right) -> left.isEmpty() ? right : left + "\n" + right);
            }
        }
        return "";
    }

    /** 基于扫描到的技术栈、业务入口和表名生成确定性项目摘要。 */
    private String deterministicSummary(String projectName,
                                        List<String> stacks,
                                        Set<String> flowPaths,
                                        Set<String> tableNames) {
        List<String> points = new ArrayList<>();
        if (!stacks.isEmpty()) {
            points.add("技术栈 " + String.join(", ", stacks));
        }
        if (!flowPaths.isEmpty()) {
            points.add("包含 " + flowPaths.size() + " 个业务入口线索");
        }
        if (!tableNames.isEmpty()) {
            points.add("发现 " + tableNames.size() + " 个数据表");
        }
        if (points.isEmpty()) {
            points.add("已生成基础项目概览");
        }
        return projectName + " 项目，" + String.join("，", points) + "。";
    }

    /** 判断文件是否值得作为证据收集（README、SQL、构建文件、业务入口、运维文件等）。 */
    private static boolean interesting(String rel, String name) {
        String lower = rel.toLowerCase(Locale.ROOT);
        return name.startsWith("README")
                || lower.endsWith(".sql")
                || name.equals("pom.xml")
                || name.equals("package.json")
                || name.equals("go.mod")
                || name.equals("pyproject.toml")
                || name.equals("Dockerfile")
                || isFlow(lower)
                || isOperational(lower)
                || lower.contains("service")
                || lower.contains("repository");
    }

    /** 判断文件路径是否属于业务入口类型（controller / router / handler / consumer / job）。 */
    private static boolean isFlow(String lower) {
        return lower.contains("controller") || lower.contains("router") || lower.contains("handler")
                || lower.contains("consumer") || lower.contains("job");
    }

    /** 判断文件路径是否属于运维类型（配置、CI/CD、异常处理、日志、安全等）。 */
    private static boolean isOperational(String lower) {
        return lower.contains("application.yml")
                || lower.contains("application.yaml")
                || lower.contains(".github/workflows")
                || lower.contains("docker")
                || lower.contains("exception")
                || lower.contains("error")
                || lower.contains("logback")
                || lower.contains("logging")
                || lower.contains("openapi")
                || lower.contains("client")
                || lower.contains("security")
                || lower.contains("auth");
    }

    /** 根据文件路径后缀和类型将证据分类（sql / flow / ops / readme / source）。 */
    private static String classify(String rel) {
        String lower = rel.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".sql")) {
            return "sql";
        }
        if (isFlow(lower)) {
            return "flow";
        }
        if (isOperational(lower)) {
            return "ops";
        }
        if (lower.startsWith("readme")) {
            return "readme";
        }
        return "source";
    }

    private static String relative(Path root, Path path) {
        return root.relativize(path).toString().replace('\\', '/');
    }

    private static String readSnippet(Path path) throws IOException {
        byte[] bytes = Files.readAllBytes(path);
        if (bytes.length > MAX_SNIPPET_BYTES) {
            bytes = java.util.Arrays.copyOf(bytes, MAX_SNIPPET_BYTES);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /**
     * 基于多个字符串值计算 SHA-256 指纹（取前 16 位十六进制字符）。
     * 用于增量发布时判断文档内容是否有变化。
     */
    static String fingerprint(List<String> values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String value : values) {
                if (value != null) {
                    digest.update(value.getBytes(StandardCharsets.UTF_8));
                }
                digest.update((byte) '\n');
            }
            return HexFormat.of().formatHex(digest.digest()).substring(0, 16);
        } catch (Exception exception) {
            throw new PluginRuntimeException("Cannot compute fingerprint", exception);
        }
    }
}
