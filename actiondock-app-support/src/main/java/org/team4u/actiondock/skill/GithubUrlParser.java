package org.team4u.actiondock.skill;

import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * GitHub 仓库 URL 解析器，负责将 GitHub 链接解析为结构化的来源信息。
 *
 * @author jay.wu
 */
class GithubUrlParser {

    private static final String DEFAULT_REF = RepositoryCatalogTypes.DEFAULT_GIT_BRANCH;
    private static final Pattern OWNER_REPO_PATTERN = Pattern.compile("[A-Za-z0-9_.-]+");

    private GithubUrlParser() {
    }

    static Source parseSource(String rawUrl) {
        String normalizedUrl = NormalizeUtils.normalize(rawUrl, "GitHub 链接不能为空");
        URI uri = parseGitHubUri(normalizedUrl);
        List<String> parts = Arrays.stream(Objects.toString(uri.getPath(), "").split("/"))
                .filter(part -> !part.isBlank())
                .toList();
        if (parts.size() < 2) {
            throw new IllegalArgumentException("GitHub 链接缺少 owner/repo");
        }
        String owner = validateOwnerRepoSegment(parts.get(0), "owner");
        String repo = validateOwnerRepoSegment(stripGitSuffix(parts.get(1)), "repo");
        String[] refAndPath = resolveRefAndPath(parts);
        return new Source(normalizedUrl, owner, repo, refAndPath[0], refAndPath[1]);
    }

    static void validateRelativePath(String path) {
        if (path.startsWith("/") || path.contains("\\") || path.contains("..")) {
            throw new IllegalArgumentException("GitHub 仓库路径非法: " + path);
        }
    }

    private static URI parseGitHubUri(String url) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("GitHub 链接格式不正确", exception);
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("仅支持 https GitHub 链接");
        }
        if (!"github.com".equalsIgnoreCase(uri.getHost())) {
            throw new IllegalArgumentException("仅支持 github.com 链接");
        }
        return uri;
    }

    private static String[] resolveRefAndPath(List<String> parts) {
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
        return new String[]{ref, path};
    }

    private static String validateOwnerRepoSegment(String value, String label) {
        String normalized = NormalizeUtils.normalize(value, "GitHub " + label + " 不能为空");
        if (!OWNER_REPO_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException("GitHub " + label + " 格式不正确: " + normalized);
        }
        return normalized;
    }

    private static String stripGitSuffix(String repo) {
        return repo.endsWith(".git") ? repo.substring(0, repo.length() - 4) : repo;
    }

    private static String normalizeRef(String ref) {
        String normalized = NormalizeUtils.normalize(ref, "GitHub ref 不能为空");
        if (normalized.contains("..") || normalized.contains("\\") || normalized.startsWith("/") || normalized.endsWith("/")) {
            throw new IllegalArgumentException("GitHub ref 格式不正确: " + normalized);
        }
        return normalized;
    }

    record Source(String url, String owner, String repo, String ref, String path) {
    }
}
