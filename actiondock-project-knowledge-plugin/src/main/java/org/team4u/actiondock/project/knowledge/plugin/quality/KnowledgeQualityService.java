package org.team4u.actiondock.project.knowledge.plugin.quality;

import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.QualityIssue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

public class KnowledgeQualityService {

    public Map<String, Object> validate(Path root) throws IOException {
        List<QualityIssue> issues = new ArrayList<>();
        Path entry = root.resolve(KnowledgeConstants.ENTRY_PATH);
        if (!Files.exists(entry)) {
            issues.add(new QualityIssue("missing-entry", KnowledgeConstants.ENTRY_PATH, "ACTIONDOCK.md is missing."));
        } else {
            checkMarkdown(root, entry, issues);
        }
        Path docs = root.resolve("docs");
        if (Files.isDirectory(docs)) {
            try (Stream<Path> stream = Files.walk(docs)) {
                stream.filter(Files::isRegularFile)
                        .filter(path -> path.getFileName().toString().endsWith(".md"))
                        .forEach(path -> checkMarkdown(root, path, issues));
            }
        }
        return Map.of(
                "ok", issues.isEmpty(),
                "issues", issues.stream().map(QualityIssue::toMap).toList()
        );
    }

    private static void checkMarkdown(Path root, Path path, List<QualityIssue> issues) {
        String relative = root.equals(path) ? path.toString() : root.relativize(path).toString();
        try {
            String content = Files.readString(path, StandardCharsets.UTF_8);
            if (content.isBlank()) {
                issues.add(new QualityIssue("empty-document", relative, "Document is empty."));
            }
            if (content.contains(KnowledgeConstants.TEMP_ROOT)) {
                issues.add(new QualityIssue("temp-reference", relative, "Formal document references .knowledge-tmp."));
            }
            if (containsPlaceholder(content)) {
                issues.add(new QualityIssue("placeholder", relative, "Formal document contains placeholder text."));
            }
        } catch (IOException exception) {
            issues.add(new QualityIssue("read-failed", relative, exception.getMessage()));
        }
    }

    private static boolean containsPlaceholder(String content) {
        String lower = content.toLowerCase(Locale.ROOT);
        return lower.contains("todo") || lower.contains("[todo") || lower.contains("placeholder");
    }
}
