package org.team4u.actiondock.workspace.plugin;

import cn.hutool.core.text.AntPathMatcher;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

final class WorkspaceSearchSupport {
    private static final int DEFAULT_MAX_RESULTS = 200;
    private static final int DEFAULT_MAX_MATCHES = 200;
    private static final int DEFAULT_MAX_MATCHES_PER_FILE = 20;
    private static final int DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;
    private static final Set<String> DEFAULT_EXCLUDED_DIRECTORIES = Set.of(
            ".git", ".hg", ".svn", "node_modules", "target", "build", "dist", "out",
            "coverage", ".gradle", ".next", ".nuxt", ".cache"
    );

    private final Path baseDir;
    private final PathValidator pathValidator;

    WorkspaceSearchSupport(Path baseDir, PathValidator pathValidator) {
        this.baseDir = baseDir.toAbsolutePath().normalize();
        this.pathValidator = pathValidator;
    }

    Map<String, Object> findFiles(Map<String, Object> values) throws IOException {
        Path root = rootPath(values);
        if (!Files.exists(root)) {
            return error("The path " + pathValue(values) + " does not exist.");
        }
        String fileType = optionalString(values.get("fileType"), "file");
        if (!fileType.equals("file") && !fileType.equals("directory") && !fileType.equals("any")) {
            return error("Invalid fileType: " + fileType + ".");
        }

        int maxResults = intValue(values.get("maxResults"), DEFAULT_MAX_RESULTS);
        SearchFilters filters = SearchFilters.from(values, baseDir, root);
        ScanResult scanResult = scan(root, filters, maxResults, path -> {
            boolean directory = Files.isDirectory(path);
            if ((fileType.equals("file") && directory) || (fileType.equals("directory") && !directory)) {
                return null;
            }
            String relativePath = relativePath(path);
            if (!filters.included(relativePath)) {
                return null;
            }
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", path.getFileName() == null ? path.toString() : path.getFileName().toString());
            entry.put("path", path.toAbsolutePath().normalize().toString());
            entry.put("relativePath", relativePath);
            entry.put("directory", directory);
            if (!directory) {
                try {
                    entry.put("size", Files.size(path));
                } catch (IOException ignored) {
                    entry.put("size", null);
                }
            }
            return entry;
        });

        Map<String, Object> result = ok("Files found.");
        result.put("rootPath", root.toString());
        result.put("files", scanResult.items());
        result.put("resultCount", scanResult.items().size());
        result.put("scannedCount", scanResult.scannedCount());
        result.put("skippedCount", scanResult.skippedCount());
        result.put("truncated", scanResult.truncated());
        return result;
    }

    Map<String, Object> searchText(Map<String, Object> values) throws IOException {
        Path root = rootPath(values);
        if (!Files.exists(root)) {
            return error("The path " + pathValue(values) + " does not exist.");
        }
        String query = requiredString(values, "query");
        boolean regex = booleanValue(values.get("regex"), true);
        boolean caseSensitive = booleanValue(values.get("caseSensitive"), true);
        int contextLines = Math.max(0, intValue(values.get("contextLines"), 0));
        int maxMatches = intValue(values.get("maxMatches"), DEFAULT_MAX_MATCHES);
        int maxMatchesPerFile = intValue(values.get("maxMatchesPerFile"), DEFAULT_MAX_MATCHES_PER_FILE);
        int maxFileSizeBytes = intValue(values.get("maxFileSizeBytes"), DEFAULT_MAX_FILE_SIZE_BYTES);
        Pattern pattern;
        try {
            int flags = caseSensitive ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
            pattern = Pattern.compile(regex ? query : Pattern.quote(query), flags);
        } catch (PatternSyntaxException exception) {
            return error("Invalid regex: " + exception.getMessage());
        }

        SearchFilters filters = SearchFilters.from(values, baseDir, root);
        SearchAccumulator accumulator = new SearchAccumulator(maxMatches);
        ScanResult scanResult = scan(root, filters, maxMatches, path -> {
            if (Files.isDirectory(path)) {
                return null;
            }
            String relativePath = relativePath(path);
            if (!filters.included(relativePath)) {
                return null;
            }
            accumulator.searchedFileCount++;
            if (!searchFile(path, relativePath, pattern, contextLines, maxMatchesPerFile, maxFileSizeBytes, accumulator)) {
                accumulator.skippedFileCount++;
            }
            return null;
        });

        accumulator.matches.sort(Comparator.comparing(item -> String.valueOf(item.get("relativePath")) + ":" + item.get("lineNumber")));
        Map<String, Object> result = ok("Text search finished.");
        result.put("rootPath", root.toString());
        result.put("matches", accumulator.matches);
        result.put("matchCount", accumulator.matches.size());
        result.put("matchedFileCount", accumulator.matchedFiles.size());
        result.put("searchedFileCount", accumulator.searchedFileCount);
        result.put("skippedFileCount", accumulator.skippedFileCount + scanResult.skippedCount());
        result.put("truncated", accumulator.truncated || scanResult.truncated());
        return result;
    }

    private ScanResult scan(Path root, SearchFilters filters, int maxItems, ResultFactory resultFactory) throws IOException {
        List<Map<String, Object>> items = new ArrayList<>();
        Counter counter = new Counter();
        if (Files.isRegularFile(root)) {
            Map<String, Object> item = resultFactory.create(root);
            if (item != null) {
                items.add(item);
            }
            return new ScanResult(items, 1, 0, items.size() >= maxItems);
        }

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                if (!dir.equals(root) && Files.isSymbolicLink(dir)) {
                    counter.skippedCount++;
                    return FileVisitResult.SKIP_SUBTREE;
                }
                String relativePath = relativePath(dir);
                if (!dir.equals(root) && filters.excluded(relativePath, true) && !filters.hasNegatedDescendantRule(relativePath)) {
                    counter.skippedCount++;
                    return FileVisitResult.SKIP_SUBTREE;
                }
                filters.enterDirectory(dir);
                if (!dir.equals(root)) {
                    counter.scannedCount++;
                    Map<String, Object> item = resultFactory.create(dir);
                    if (item != null) {
                        items.add(item);
                        if (items.size() >= maxItems) {
                            counter.truncated = true;
                            return FileVisitResult.TERMINATE;
                        }
                    }
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                if (Files.isSymbolicLink(file) || filters.excluded(relativePath(file), false)) {
                    counter.skippedCount++;
                    return FileVisitResult.CONTINUE;
                }
                counter.scannedCount++;
                Map<String, Object> item = resultFactory.create(file);
                if (item != null) {
                    items.add(item);
                    if (items.size() >= maxItems) {
                        counter.truncated = true;
                        return FileVisitResult.TERMINATE;
                    }
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                counter.skippedCount++;
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
                filters.leaveDirectory(dir);
                if (exc != null) {
                    counter.skippedCount++;
                }
                return FileVisitResult.CONTINUE;
            }
        });
        items.sort(Comparator.comparing(item -> String.valueOf(item.get("relativePath"))));
        return new ScanResult(items, counter.scannedCount, counter.skippedCount, counter.truncated);
    }

    private boolean searchFile(Path path,
                               String relativePath,
                               Pattern pattern,
                               int contextLines,
                               int maxMatchesPerFile,
                               int maxFileSizeBytes,
                               SearchAccumulator accumulator) throws IOException {
        if (!Files.isRegularFile(path) || !Files.isReadable(path) || Files.size(path) > maxFileSizeBytes || looksBinary(path)) {
            return false;
        }
        List<String> lines = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(Files.newInputStream(path), StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)))) {
            String line;
            while ((line = reader.readLine()) != null) {
                lines.add(line);
            }
        } catch (CharacterCodingException exception) {
            return false;
        }

        int fileMatches = 0;
        boolean matched = false;
        for (int i = 0; i < lines.size(); i++) {
            Matcher matcher = pattern.matcher(lines.get(i));
            while (matcher.find()) {
                if (matcher.start() == matcher.end()) {
                    continue;
                }
                if (accumulator.matches.size() >= accumulator.maxMatches || fileMatches >= maxMatchesPerFile) {
                    accumulator.truncated = true;
                    return true;
                }
                matched = true;
                fileMatches++;
                accumulator.matches.add(matchEntry(path, relativePath, lines, i, matcher, contextLines));
            }
        }
        if (matched) {
            accumulator.matchedFiles.add(relativePath);
        }
        return true;
    }

    private Map<String, Object> matchEntry(Path path,
                                           String relativePath,
                                           List<String> lines,
                                           int lineIndex,
                                           Matcher matcher,
                                           int contextLines) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("filePath", path.toAbsolutePath().normalize().toString());
        entry.put("relativePath", relativePath);
        entry.put("lineNumber", lineIndex + 1);
        entry.put("startColumn", matcher.start() + 1);
        entry.put("endColumn", matcher.end() + 1);
        entry.put("line", lines.get(lineIndex));
        entry.put("matchText", matcher.group());
        if (contextLines > 0) {
            entry.put("before", lines.subList(Math.max(0, lineIndex - contextLines), lineIndex));
            entry.put("after", lines.subList(lineIndex + 1, Math.min(lines.size(), lineIndex + contextLines + 1)));
        }
        return entry;
    }

    private boolean looksBinary(Path path) throws IOException {
        byte[] bytes;
        try (var input = Files.newInputStream(path)) {
            bytes = input.readNBytes(4096);
        }
        for (byte item : bytes) {
            if (item == 0) {
                return true;
            }
        }
        return false;
    }

    private Path rootPath(Map<String, Object> values) throws IOException {
        return pathValidator.apply(pathValue(values), baseDir);
    }

    private String pathValue(Map<String, Object> values) {
        return optionalString(values.get("path"), ".");
    }

    private String relativePath(Path path) {
        Path absolute = path.toAbsolutePath().normalize();
        String relative = baseDir.relativize(absolute).toString().replace('\\', '/');
        return relative.isBlank() ? "." : relative;
    }

    private Map<String, Object> ok(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("message", message);
        return result;
    }

    private Map<String, Object> error(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", false);
        result.put("error", message);
        result.put("message", message);
        return result;
    }

    private String requiredString(Map<String, Object> values, String key) {
        String value = stringValue(values.get(key));
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(key + " is required");
        }
        return value;
    }

    private String optionalString(Object value, String defaultValue) {
        String text = stringValue(value);
        return text == null || text.isBlank() ? defaultValue : text;
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private int intValue(Object value, int defaultValue) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value != null) {
            try {
                return Integer.parseInt(String.valueOf(value));
            } catch (NumberFormatException ignored) {
                return defaultValue;
            }
        }
        return defaultValue;
    }

    private boolean booleanValue(Object value, boolean defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    private Set<String> stringSet(Object value) {
        Set<String> result = new LinkedHashSet<>();
        if (value instanceof Iterable<?> iterable) {
            iterable.forEach(item -> {
                if (item != null && !String.valueOf(item).isBlank()) {
                    result.add(String.valueOf(item).trim());
                }
            });
        } else if (value instanceof String text && !text.isBlank()) {
            for (String item : text.split(",")) {
                if (!item.isBlank()) {
                    result.add(item.trim());
                }
            }
        }
        return result;
    }

    private interface ResultFactory {
        Map<String, Object> create(Path path) throws IOException;
    }

    @FunctionalInterface
    interface PathValidator {
        Path apply(String path, Path baseDir) throws IOException;
    }

    private record ScanResult(List<Map<String, Object>> items, int scannedCount, int skippedCount, boolean truncated) {
    }

    private static final class Counter {
        private int scannedCount;
        private int skippedCount;
        private boolean truncated;
    }

    private static final class SearchAccumulator {
        private final int maxMatches;
        private final List<Map<String, Object>> matches = new ArrayList<>();
        private final Set<String> matchedFiles = new LinkedHashSet<>();
        private int searchedFileCount;
        private int skippedFileCount;
        private boolean truncated;

        private SearchAccumulator(int maxMatches) {
            this.maxMatches = maxMatches;
        }
    }

    private final class SearchFilters {
        private final AntPathMatcher matcher = new AntPathMatcher("/");
        private final Set<String> includeGlobs;
        private final Set<String> excludeGlobs;
        private final boolean includeDefaultExcludes;
        private final boolean respectGitIgnore;
        private final Deque<List<IgnoreRule>> ignoreStack = new ArrayDeque<>();

        private SearchFilters(Set<String> includeGlobs,
                              Set<String> excludeGlobs,
                              boolean includeDefaultExcludes,
                              boolean respectGitIgnore) {
            this.includeGlobs = includeGlobs;
            this.excludeGlobs = excludeGlobs;
            this.includeDefaultExcludes = includeDefaultExcludes;
            this.respectGitIgnore = respectGitIgnore;
        }

        private static SearchFilters from(Map<String, Object> values, Path baseDir, Path root) throws IOException {
            WorkspaceSearchSupport support = new WorkspaceSearchSupport(baseDir, (path, ignored) -> root);
            SearchFilters filters = support.new SearchFilters(
                    support.stringSet(values.get("includeGlobs")),
                    support.stringSet(values.get("excludeGlobs")),
                    support.booleanValue(values.get("includeDefaultExcludes"), true),
                    support.booleanValue(values.get("respectGitIgnore"), true)
            );
            filters.loadAncestorIgnores(baseDir, root);
            return filters;
        }

        private boolean included(String relativePath) {
            if (includeGlobs.isEmpty()) {
                return true;
            }
            return includeGlobs.stream().anyMatch(glob -> matchesGlob(glob, relativePath));
        }

        private boolean excluded(String relativePath, boolean directory) {
            if (includeDefaultExcludes && directory && DEFAULT_EXCLUDED_DIRECTORIES.contains(fileName(relativePath))) {
                return true;
            }
            if (excludeGlobs.stream().anyMatch(glob -> matchesGlob(glob, relativePath))) {
                return true;
            }
            return respectGitIgnore && ignoredByGitIgnore(relativePath, directory);
        }

        private boolean hasNegatedDescendantRule(String relativePath) {
            if (!respectGitIgnore) {
                return false;
            }
            String prefix = relativePath.endsWith("/") ? relativePath : relativePath + "/";
            List<IgnoreRule> rules = new ArrayList<>();
            ignoreStack.descendingIterator().forEachRemaining(rules::addAll);
            return rules.stream().anyMatch(rule -> rule.negated()
                    && (rule.pattern().startsWith(prefix) || prefix.startsWith(rule.pattern() + "/")));
        }

        private void enterDirectory(Path dir) {
            if (!respectGitIgnore) {
                ignoreStack.push(List.of());
                return;
            }
            ignoreStack.push(readIgnoreRules(dir.resolve(".gitignore"), relativePath(dir)));
        }

        private void leaveDirectory(Path dir) {
            if (!ignoreStack.isEmpty()) {
                ignoreStack.pop();
            }
        }

        private void loadAncestorIgnores(Path baseDir, Path root) throws IOException {
            if (!respectGitIgnore) {
                return;
            }
            List<Path> ancestors = new ArrayList<>();
            Path current = root.toAbsolutePath().normalize();
            while (current != null && current.startsWith(baseDir.toAbsolutePath().normalize())) {
                ancestors.add(current);
                if (current.equals(baseDir.toAbsolutePath().normalize())) {
                    break;
                }
                current = current.getParent();
            }
            for (int i = ancestors.size() - 1; i >= 0; i--) {
                Path ancestor = ancestors.get(i);
                Path ignoreFile = ancestor.resolve(".gitignore");
                if (Files.isRegularFile(ignoreFile)) {
                    ignoreStack.push(readIgnoreRules(ignoreFile, relativePath(ancestor)));
                }
            }
        }

        private boolean ignoredByGitIgnore(String relativePath, boolean directory) {
            Boolean ignored = null;
            List<IgnoreRule> rules = new ArrayList<>();
            ignoreStack.descendingIterator().forEachRemaining(rules::addAll);
            for (IgnoreRule rule : rules) {
                if (rule.matches(relativePath, directory, matcher)) {
                    ignored = !rule.negated();
                }
            }
            return Boolean.TRUE.equals(ignored);
        }

        private List<IgnoreRule> readIgnoreRules(Path ignoreFile, String parentRelativePath) {
            if (!Files.isRegularFile(ignoreFile)) {
                return List.of();
            }
            List<IgnoreRule> rules = new ArrayList<>();
            try {
                for (String line : Files.readAllLines(ignoreFile, StandardCharsets.UTF_8)) {
                    IgnoreRule rule = IgnoreRule.parse(line, parentRelativePath);
                    if (rule != null) {
                        rules.add(rule);
                    }
                }
            } catch (IOException ignored) {
                return List.of();
            }
            return rules;
        }

        private boolean matchesGlob(String glob, String relativePath) {
            String normalized = normalizePattern(glob);
            return matcher.match(normalized, relativePath) || matcher.match("**/" + normalized, relativePath);
        }

        private String normalizePattern(String glob) {
            String normalized = glob.replace('\\', '/');
            while (normalized.startsWith("/")) {
                normalized = normalized.substring(1);
            }
            return normalized;
        }

        private String fileName(String relativePath) {
            int separator = relativePath.lastIndexOf('/');
            return separator >= 0 ? relativePath.substring(separator + 1) : relativePath;
        }
    }

    private record IgnoreRule(String pattern, boolean negated, boolean directoryOnly, boolean anchored) {
        private static IgnoreRule parse(String line, String parentRelativePath) {
            String text = line.strip();
            if (text.isEmpty() || text.startsWith("#")) {
                return null;
            }
            boolean negated = text.startsWith("!");
            if (negated) {
                text = text.substring(1).strip();
            }
            boolean anchored = text.startsWith("/");
            while (text.startsWith("/")) {
                text = text.substring(1);
            }
            boolean directoryOnly = text.endsWith("/");
            while (text.endsWith("/")) {
                text = text.substring(0, text.length() - 1);
            }
            if (text.isBlank()) {
                return null;
            }
            String base = ".".equals(parentRelativePath) ? "" : parentRelativePath + "/";
            String pattern = anchored || text.contains("/") ? base + text : text;
            return new IgnoreRule(pattern.replace('\\', '/'), negated, directoryOnly, anchored || text.contains("/"));
        }

        private boolean matches(String relativePath, boolean directory, AntPathMatcher matcher) {
            if (directoryOnly) {
                return matcher.match(pattern, relativePath)
                        || matcher.match(pattern + "/**", relativePath)
                        || (!anchored && matcher.match("**/" + pattern, relativePath))
                        || (!anchored && matcher.match("**/" + pattern + "/**", relativePath));
            }
            if (anchored) {
                return matcher.match(pattern, relativePath) || matcher.match(pattern + "/**", relativePath);
            }
            return matcher.match(pattern, relativePath)
                    || matcher.match("**/" + pattern, relativePath)
                    || matcher.match(pattern + "/**", relativePath)
                    || matcher.match("**/" + pattern + "/**", relativePath);
        }
    }
}
