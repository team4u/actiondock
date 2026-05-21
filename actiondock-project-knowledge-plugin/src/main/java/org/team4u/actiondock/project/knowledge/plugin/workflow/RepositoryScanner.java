package org.team4u.actiondock.project.knowledge.plugin.workflow;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.project.knowledge.plugin.domain.KnowledgeConstants;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class RepositoryScanner {

    public RepositoryFacts scan(MaintenanceRequest request) throws IOException {
        Path root = request.repoPath();
        if (!Files.exists(root)) {
            throw new PluginRuntimeException("repoPath does not exist: " + root);
        }
        if (!Files.isDirectory(root)) {
            throw new PluginRuntimeException("repoPath must be a directory: " + root);
        }

        List<String> detected = new ArrayList<>();
        List<String> domains = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        detect(root, detected, "pom.xml", "java-maven");
        detect(root, detected, "package.json", "node");
        detect(root, detected, "README.md", "readme");
        detect(root, detected, KnowledgeConstants.ENTRY_PATH, "actiondock-entry");
        detect(root, detected, "src/main/resources/db/migration", "database");

        if (detected.stream().anyMatch(item -> item.endsWith("pom.xml"))) {
            domains.add("java");
        }
        if (detected.stream().anyMatch(item -> item.endsWith("package.json"))) {
            domains.add("frontend");
        }
        if (detected.stream().anyMatch(item -> item.contains("db/migration"))) {
            domains.add("data");
        }
        domains.add("actiondock");
        domains.add("common");
        if (!Files.exists(root.resolve(KnowledgeConstants.ENTRY_PATH))) {
            warnings.add("ACTIONDOCK.md is missing and will be initialized.");
        }
        for (String evidenceFile : request.evidenceFiles()) {
            Path evidencePath = root.resolve(evidenceFile).normalize();
            if (Files.exists(evidencePath)) {
                detected.add("evidence:" + evidenceFile);
            } else {
                warnings.add("Evidence file not found: " + evidenceFile);
            }
        }
        return new RepositoryFacts(root, detected, distinct(domains), warnings, request.evidenceFiles());
    }

    private static void detect(Path root, List<String> detected, String relativePath, String label) {
        if (Files.exists(root.resolve(relativePath))) {
            detected.add(label + ":" + relativePath);
        }
    }

    private static List<String> distinct(List<String> values) {
        return values.stream().distinct().toList();
    }
}
