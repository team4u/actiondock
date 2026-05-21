package org.team4u.actiondock.project.knowledge.plugin.domain;

import java.nio.file.Path;
import java.util.List;

public record RepositoryFacts(
        Path root,
        List<String> detectedFiles,
        List<String> activatedDomains,
        List<String> warnings,
        List<String> evidenceFiles
) {
}
