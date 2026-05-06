package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.shared.NormalizeUtils;

import static org.team4u.actiondock.skill.SkillTypes.*;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class GithubSkillCollectionService {
    private static final long MAX_REPOSITORY_ARCHIVE_SIZE = 100L * 1024L * 1024L;

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
        return withPreparedRepository(url, (source, repository) -> {
            Path collectionRoot = resolveCollectionRoot(repository.repoRoot(), source.path());
            List<GithubSkillScanItem> skills = scanSkills(repository.repoRoot(), collectionRoot);
            return new GithubSkillScanResponse(
                    source.url(), source.owner(), source.repo(), source.ref(),
                    normalizeRepoRelativePath(repository.repoRoot(), collectionRoot),
                    skills);
        });
    }

    public GithubSkillInstallResponse install(String url, List<String> targetIds, List<String> skillPaths) {
        List<String> normalizedTargetIds = NormalizeUtils.normalizeTargetIds(targetIds);
        List<String> normalizedSkillPaths = normalizeSkillPaths(skillPaths);
        return withPreparedRepository(url, (source, repository) -> {
            Path collectionRoot = resolveCollectionRoot(repository.repoRoot(), source.path());
            Set<String> availablePaths = scanSkills(repository.repoRoot(), collectionRoot).stream()
                    .map(GithubSkillScanItem::path)
                    .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
            String repositoryId = "github:" + source.owner() + "/" + source.repo() + "#" + source.ref();
            List<GithubSkillInstallResult> results = installEachSkill(
                    normalizedTargetIds, normalizedSkillPaths, availablePaths, repository.repoRoot(), repositoryId);
            return new GithubSkillInstallResponse(
                    source.url(), source.owner(), source.repo(), source.ref(),
                    normalizeRepoRelativePath(repository.repoRoot(), collectionRoot),
                    results);
        });
    }

    private <T> T withPreparedRepository(String url, java.util.function.BiFunction<GithubUrlParser.Source, PreparedRepository, T> action) {
        GithubUrlParser.Source source = GithubUrlParser.parseSource(url);
        Path tempDir = createTempDir();
        try {
            return action.apply(source, prepareRepository(source, tempDir));
        } finally {
            SkillFileUtils.deleteQuietly(tempDir);
        }
    }

    private List<GithubSkillInstallResult> installEachSkill(List<String> targetIds,
                                                             List<String> skillPaths,
                                                             Set<String> availablePaths,
                                                             Path repoRoot,
                                                             String repositoryId) {
        List<GithubSkillInstallResult> results = new ArrayList<>();
        for (String skillPath : skillPaths) {
            results.add(installSingleSkill(targetIds, skillPath, availablePaths, repoRoot, repositoryId));
        }
        return results;
    }

    private GithubSkillInstallResult installSingleSkill(List<String> targetIds,
                                                         String skillPath,
                                                         Set<String> availablePaths,
                                                         Path repoRoot,
                                                         String repositoryId) {
        if (!availablePaths.contains(skillPath)) {
            return new GithubSkillInstallResult(skillPath, null, STATUS_FAILED, "GitHub 集合中未找到该 Skill", null);
        }
        Path skillDirectory = resolveRepoRelativePath(repoRoot, skillPath);
        try {
            SkillTypes.SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(skillDirectory, skillDirectory.getFileName().toString(), false, jsonCodec);
            SkillTypes.SkillListItem skill = skillService.installFromDirectory(targetIds, skillDirectory.toString(), repositoryId);
            return new GithubSkillInstallResult(skillPath, validation.skillId(), STATUS_SUCCESS, "Skill 已安装", skill);
        } catch (RuntimeException exception) {
            return new GithubSkillInstallResult(skillPath, null, STATUS_FAILED, summarize(exception), null);
        }
    }

    private List<GithubSkillScanItem> scanSkills(Path repoRoot, Path collectionRoot) {
        if (Files.notExists(collectionRoot) || !Files.isDirectory(collectionRoot)) {
            throw new IllegalArgumentException("GitHub 仓库中未找到 Skill 集合目录: " + normalizeRepoRelativePath(repoRoot, collectionRoot));
        }
        try (var stream = Files.list(collectionRoot)) {
            List<GithubSkillScanItem> items = new ArrayList<>();
            for (Path candidate : stream.filter(Files::isDirectory).sorted(Comparator.comparing(path -> path.getFileName().toString().toLowerCase(Locale.ROOT))).toList()) {
                if (Files.notExists(candidate.resolve(SkillFileUtils.SKILL_MANIFEST_FILE))) {
                    continue;
                }
                try {
                    SkillTypes.SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(candidate, candidate.getFileName().toString(), false, jsonCodec);
                    items.add(new GithubSkillScanItem(
                            validation.skillId(),
                            validation.displayName(),
                            validation.version(),
                            validation.description(),
                            normalizeRepoRelativePath(repoRoot, SkillFileUtils.locateSkillRoot(candidate)),
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

    private static Path resolveCollectionRoot(Path repoRoot, String requestedPath) {
        if (NormalizeUtils.isNotBlank(requestedPath)) {
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

    private PreparedRepository prepareRepository(GithubUrlParser.Source source, Path tempDir) {
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
                return new PreparedRepository(NormalizeUtils.normalizePath(topLevels.get(0)));
            }
        } catch (IOException exception) {
            throw new IllegalStateException("解压 GitHub 仓库失败", exception);
        }
    }

    private byte[] downloadRepositoryArchive(GithubUrlParser.Source source) {
        byte[] body = archiveDownloader.download(source.owner(), source.repo(), source.ref());
        if (body == null || body.length == 0) {
            throw new IllegalArgumentException("下载 GitHub 仓库失败: 内容为空");
        }
        if (body.length > MAX_REPOSITORY_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("GitHub 仓库归档过大，超过 100MB");
        }
        return body;
    }

    private static List<String> normalizeSkillPaths(List<String> skillPaths) {
        List<String> normalized = NormalizeUtils.nullSafeList(skillPaths).stream()
                .map(path -> NormalizeUtils.normalize(path, "Skill 路径不能为空"))
                .peek(GithubUrlParser::validateRelativePath)
                .distinct()
                .toList();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("至少需要选择一个 Skill");
        }
        return normalized;
    }

    private static Path resolveRepoRelativePath(Path repoRoot, String relativePath) {
        GithubUrlParser.validateRelativePath(relativePath);
        Path normalizedRoot = NormalizeUtils.normalizePath(repoRoot);
        Path resolved = normalizedRoot.resolve(relativePath).normalize();
        if (!resolved.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException("GitHub 仓库路径越界: " + relativePath);
        }
        return resolved;
    }

    private static String normalizeRepoRelativePath(Path repoRoot, Path path) {
        Path normalizedRoot = NormalizeUtils.normalizePath(repoRoot);
        Path normalizedPath = NormalizeUtils.normalizePath(path);
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
        SkillArchiveManager.unzipToDirectory(content, directory, MAX_REPOSITORY_ARCHIVE_SIZE, "GitHub 仓库归档");
    }

    private static String summarize(Throwable exception) {
        if (exception == null) {
            return "未知错误";
        }
        if (NormalizeUtils.isNotBlank(exception.getMessage())) {
            return exception.getMessage();
        }
        return exception.getClass().getSimpleName();
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
            SkillTypes.SkillListItem skill
    ) {
    }

    @FunctionalInterface
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
