package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.port.JsonCodec;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class GithubSkillCollectionService {
    private static final String DEFAULT_REF = "main";
    private static final long MAX_REPOSITORY_ARCHIVE_SIZE = 100L * 1024L * 1024L;
    private static final Pattern OWNER_REPO_PATTERN = Pattern.compile("[A-Za-z0-9_.-]+");

    private final SkillService skillService;
    private final JsonCodec jsonCodec;
    private final RepositoryArchiveDownloader archiveDownloader;

    public GithubSkillCollectionService(SkillService skillService, JsonCodec jsonCodec) {
        this(
                skillService,
                jsonCodec,
                new HttpRepositoryArchiveDownloader(HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(10))
                        .followRedirects(HttpClient.Redirect.NORMAL)
                        .build())
        );
    }

    GithubSkillCollectionService(SkillService skillService, JsonCodec jsonCodec, RepositoryArchiveDownloader archiveDownloader) {
        this.skillService = skillService;
        this.jsonCodec = jsonCodec;
        this.archiveDownloader = archiveDownloader;
    }

    public GithubSkillScanResponse scan(String url) {
        Source source = parseSource(url);
        Path tempDir = createTempDir();
        try {
            PreparedRepository repository = prepareRepository(source, tempDir);
            Path collectionRoot = resolveCollectionRoot(repository.repoRoot(), source.path());
            List<GithubSkillScanItem> skills = scanSkills(repository.repoRoot(), collectionRoot);
            return new GithubSkillScanResponse(
                    source.url(),
                    source.owner(),
                    source.repo(),
                    source.ref(),
                    normalizeRepoRelativePath(repository.repoRoot(), collectionRoot),
                    skills
            );
        } finally {
            deleteQuietly(tempDir);
        }
    }

    public GithubSkillInstallResponse install(String url, List<String> targetIds, List<String> skillPaths) {
        List<String> normalizedTargetIds = normalizeTargetIds(targetIds);
        List<String> normalizedSkillPaths = normalizeSkillPaths(skillPaths);
        Source source = parseSource(url);
        Path tempDir = createTempDir();
        try {
            PreparedRepository repository = prepareRepository(source, tempDir);
            Path collectionRoot = resolveCollectionRoot(repository.repoRoot(), source.path());
            Set<String> availablePaths = scanSkills(repository.repoRoot(), collectionRoot).stream()
                    .map(GithubSkillScanItem::path)
                    .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
            List<GithubSkillInstallResult> results = new ArrayList<>();
            String repositoryId = "github:" + source.owner() + "/" + source.repo() + "#" + source.ref();
            for (String skillPath : normalizedSkillPaths) {
                if (!availablePaths.contains(skillPath)) {
                    results.add(new GithubSkillInstallResult(skillPath, null, "FAILED", "GitHub 集合中未找到该 Skill", null));
                    continue;
                }
                Path skillDirectory = resolveRepoRelativePath(repository.repoRoot(), skillPath);
                try {
                    SkillService.SkillValidationResult validation = SkillService.validateSkillDirectory(skillDirectory, skillDirectory.getFileName().toString(), false, jsonCodec);
                    SkillService.SkillListItem skill = skillService.installFromDirectory(normalizedTargetIds, skillDirectory.toString(), repositoryId);
                    results.add(new GithubSkillInstallResult(skillPath, validation.skillId(), "SUCCESS", "Skill 已安装", skill));
                } catch (RuntimeException exception) {
                    results.add(new GithubSkillInstallResult(skillPath, null, "FAILED", summarize(exception), null));
                }
            }
            return new GithubSkillInstallResponse(
                    source.url(),
                    source.owner(),
                    source.repo(),
                    source.ref(),
                    normalizeRepoRelativePath(repository.repoRoot(), collectionRoot),
                    results
            );
        } finally {
            deleteQuietly(tempDir);
        }
    }

    private List<GithubSkillScanItem> scanSkills(Path repoRoot, Path collectionRoot) {
        if (Files.notExists(collectionRoot) || !Files.isDirectory(collectionRoot)) {
            throw new IllegalArgumentException("GitHub 仓库中未找到 Skill 集合目录: " + normalizeRepoRelativePath(repoRoot, collectionRoot));
        }
        try (var stream = Files.list(collectionRoot)) {
            List<GithubSkillScanItem> items = new ArrayList<>();
            for (Path candidate : stream.filter(Files::isDirectory).sorted(Comparator.comparing(path -> path.getFileName().toString().toLowerCase(Locale.ROOT))).toList()) {
                if (Files.notExists(candidate.resolve("SKILL.md"))) {
                    continue;
                }
                try {
                    SkillService.SkillValidationResult validation = SkillService.validateSkillDirectory(candidate, candidate.getFileName().toString(), false, jsonCodec);
                    items.add(new GithubSkillScanItem(
                            validation.skillId(),
                            validation.displayName(),
                            validation.version(),
                            validation.description(),
                            normalizeRepoRelativePath(repoRoot, SkillService.locateSkillRoot(candidate)),
                            validation.digest(),
                            validation.warnings()
                    ));
                } catch (RuntimeException ignored) {
                    // Invalid candidates are not installable; keep the scan list actionable.
                }
            }
            if (items.isEmpty()) {
                throw new IllegalArgumentException("GitHub 集合目录中未找到有效可安装的 Skill 子目录");
            }
            return items;
        } catch (IOException exception) {
            throw new IllegalStateException("扫描 GitHub Skill 集合失败", exception);
        }
    }

    private Path resolveCollectionRoot(Path repoRoot, String requestedPath) {
        if (requestedPath != null && !requestedPath.isBlank()) {
            return resolveRepoRelativePath(repoRoot, requestedPath);
        }
        Path lower = repoRoot.resolve("skills").normalize();
        if (Files.isDirectory(lower)) {
            return lower;
        }
        Path upper = repoRoot.resolve("Skills").normalize();
        if (Files.isDirectory(upper)) {
            return upper;
        }
        return lower;
    }

    private PreparedRepository prepareRepository(Source source, Path tempDir) {
        byte[] archive = downloadRepositoryArchive(source);
        Path extractRoot = tempDir.resolve("repo");
        try {
            Files.createDirectories(extractRoot);
            unzipRepositoryArchive(archive, extractRoot);
            try (var stream = Files.list(extractRoot)) {
                List<Path> topLevels = stream.filter(Files::isDirectory).toList();
                if (topLevels.size() != 1) {
                    throw new IllegalArgumentException("GitHub 仓库归档结构异常");
                }
                return new PreparedRepository(topLevels.get(0).toAbsolutePath().normalize());
            }
        } catch (IOException exception) {
            throw new IllegalStateException("解压 GitHub 仓库失败", exception);
        }
    }

    private byte[] downloadRepositoryArchive(Source source) {
        byte[] body = archiveDownloader.download(source.owner(), source.repo(), source.ref());
        if (body == null || body.length == 0) {
            throw new IllegalArgumentException("下载 GitHub 仓库失败: 内容为空");
        }
        if (body.length > MAX_REPOSITORY_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("GitHub 仓库归档过大，超过 100MB");
        }
        return body;
    }

    private static Source parseSource(String rawUrl) {
        String normalizedUrl = normalize(rawUrl, "GitHub 链接不能为空");
        URI uri;
        try {
            uri = URI.create(normalizedUrl);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("GitHub 链接格式不正确", exception);
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("仅支持 https GitHub 链接");
        }
        if (!"github.com".equalsIgnoreCase(uri.getHost())) {
            throw new IllegalArgumentException("仅支持 github.com 链接");
        }
        List<String> parts = java.util.Arrays.stream(Objects.toString(uri.getPath(), "").split("/"))
                .filter(part -> !part.isBlank())
                .toList();
        if (parts.size() < 2) {
            throw new IllegalArgumentException("GitHub 链接缺少 owner/repo");
        }
        String owner = validateOwnerRepoSegment(parts.get(0), "owner");
        String repo = validateOwnerRepoSegment(stripGitSuffix(parts.get(1)), "repo");
        String ref = DEFAULT_REF;
        String path = null;
        if (parts.size() > 2) {
            if (!"tree".equals(parts.get(2))) {
                throw new IllegalArgumentException("仅支持仓库根链接或 /tree/{ref}/{path} 链接");
            }
            if (parts.size() < 4) {
                throw new IllegalArgumentException("GitHub tree 链接缺少 ref");
            }
            ref = normalizeRef(parts.get(3));
            path = parts.size() > 4 ? String.join("/", parts.subList(4, parts.size())) : null;
            if (path != null) {
                validateRelativePath(path);
            }
        }
        return new Source(normalizedUrl, owner, repo, ref, path);
    }

    private static String validateOwnerRepoSegment(String value, String label) {
        String normalized = normalize(value, "GitHub " + label + " 不能为空");
        if (!OWNER_REPO_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException("GitHub " + label + " 格式不正确: " + normalized);
        }
        return normalized;
    }

    private static String stripGitSuffix(String repo) {
        return repo.endsWith(".git") ? repo.substring(0, repo.length() - 4) : repo;
    }

    private static String normalizeRef(String ref) {
        String normalized = normalize(ref, "GitHub ref 不能为空");
        if (normalized.contains("..") || normalized.contains("\\") || normalized.startsWith("/") || normalized.endsWith("/")) {
            throw new IllegalArgumentException("GitHub ref 格式不正确: " + normalized);
        }
        return normalized;
    }

    private static List<String> normalizeTargetIds(List<String> targetIds) {
        List<String> normalized = targetIds == null ? List.of() : targetIds.stream()
                .map(id -> normalize(id, "targetId 不能为空"))
                .distinct()
                .toList();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("至少需要一个 SkillTarget");
        }
        return normalized;
    }

    private static List<String> normalizeSkillPaths(List<String> skillPaths) {
        List<String> normalized = skillPaths == null ? List.of() : skillPaths.stream()
                .map(path -> normalize(path, "Skill 路径不能为空"))
                .peek(GithubSkillCollectionService::validateRelativePath)
                .distinct()
                .toList();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("至少需要选择一个 Skill");
        }
        return normalized;
    }

    private static void validateRelativePath(String path) {
        if (path.startsWith("/") || path.contains("\\") || path.contains("..")) {
            throw new IllegalArgumentException("GitHub 仓库路径非法: " + path);
        }
    }

    private static Path resolveRepoRelativePath(Path repoRoot, String relativePath) {
        validateRelativePath(relativePath);
        Path normalizedRoot = repoRoot.toAbsolutePath().normalize();
        Path resolved = normalizedRoot.resolve(relativePath).normalize();
        if (!resolved.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException("GitHub 仓库路径越界: " + relativePath);
        }
        return resolved;
    }

    private static String normalizeRepoRelativePath(Path repoRoot, Path path) {
        Path normalizedRoot = repoRoot.toAbsolutePath().normalize();
        Path normalizedPath = path.toAbsolutePath().normalize();
        if (!normalizedPath.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException("GitHub 仓库路径越界: " + path);
        }
        return normalizedRoot.relativize(normalizedPath).toString().replace('\\', '/');
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("actiondock-github-skills-");
        } catch (IOException exception) {
            throw new IllegalStateException("创建 GitHub Skill 临时目录失败", exception);
        }
    }

    private static void unzipRepositoryArchive(byte[] content, Path directory) {
        try (InputStream inputStream = new java.io.ByteArrayInputStream(content);
             ZipInputStream zipInputStream = new ZipInputStream(inputStream, StandardCharsets.UTF_8)) {
            ZipEntry entry;
            long totalBytes = 0L;
            while ((entry = zipInputStream.getNextEntry()) != null) {
                if (entry.getName() == null || entry.getName().isBlank()) {
                    continue;
                }
                String entryName = entry.getName().replace('\\', '/');
                if (entryName.startsWith("/") || entryName.contains("../") || entryName.contains("..\\")) {
                    throw new IllegalArgumentException("GitHub 仓库归档包含非法路径: " + entry.getName());
                }
                Path target = directory.resolve(entryName).normalize();
                if (!target.toAbsolutePath().startsWith(directory.toAbsolutePath())) {
                    throw new IllegalArgumentException("GitHub 仓库归档越界写入被拒绝: " + entry.getName());
                }
                if (entry.isDirectory()) {
                    Files.createDirectories(target);
                    continue;
                }
                Files.createDirectories(target.getParent());
                try (OutputStream outputStream = Files.newOutputStream(target)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = zipInputStream.read(buffer)) != -1) {
                        totalBytes += read;
                        if (totalBytes > MAX_REPOSITORY_ARCHIVE_SIZE) {
                            throw new IllegalArgumentException("GitHub 仓库归档解压后过大，超过 100MB");
                        }
                        outputStream.write(buffer, 0, read);
                    }
                }
            }
        } catch (IOException exception) {
            throw new IllegalStateException("解压 GitHub 仓库归档失败", exception);
        }
    }

    private static void deleteQuietly(Path path) {
        if (path == null || Files.notExists(path)) {
            return;
        }
        try {
            Files.walkFileTree(path, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.deleteIfExists(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                    Files.deleteIfExists(dir);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException ignored) {
        }
    }

    private static String summarize(Throwable exception) {
        if (exception == null) {
            return "未知错误";
        }
        if (exception.getMessage() != null && !exception.getMessage().isBlank()) {
            return exception.getMessage();
        }
        return exception.getClass().getSimpleName();
    }

    private static String normalize(String value, String message) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    private record Source(String url, String owner, String repo, String ref, String path) {
    }

    private record PreparedRepository(Path repoRoot) {
    }

    public record GithubSkillScanResponse(
            String sourceUrl,
            String owner,
            String repo,
            String ref,
            String rootPath,
            List<GithubSkillScanItem> skills
    ) {
    }

    public record GithubSkillScanItem(
            String skillId,
            String displayName,
            String version,
            String description,
            String path,
            String digest,
            List<String> warnings
    ) {
    }

    public record GithubSkillInstallResponse(
            String sourceUrl,
            String owner,
            String repo,
            String ref,
            String rootPath,
            List<GithubSkillInstallResult> results
    ) {
    }

    public record GithubSkillInstallResult(
            String path,
            String skillId,
            String status,
            String message,
            SkillService.SkillListItem skill
    ) {
    }

    interface RepositoryArchiveDownloader {
        byte[] download(String owner, String repo, String ref);
    }

    private static final class HttpRepositoryArchiveDownloader implements RepositoryArchiveDownloader {
        private final HttpClient httpClient;

        private HttpRepositoryArchiveDownloader(HttpClient httpClient) {
            this.httpClient = httpClient;
        }

        @Override
        public byte[] download(String owner, String repo, String ref) {
            URI uri = URI.create("https://codeload.github.com/" + owner + "/" + repo + "/zip/" + ref);
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(60))
                    .header("Accept", "application/zip")
                    .header("User-Agent", "ActionDock-GitHub-Skill-Installer")
                    .GET()
                    .build();
            try {
                HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                if (response.statusCode() != 200) {
                    throw new IllegalArgumentException("下载 GitHub 仓库失败: HTTP " + response.statusCode());
                }
                return response.body();
            } catch (IOException exception) {
                throw new IllegalStateException("下载 GitHub 仓库失败", exception);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("下载 GitHub 仓库被中断", exception);
            }
        }
    }
}
