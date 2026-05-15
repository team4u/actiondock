package org.team4u.actiondock.web.script;

import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptType;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public record ScriptDocumentView(
        String id,
        String name,
        ScriptType type,
        ScriptPackaging packaging,
        String source,
        String pythonRequirements,
        Map<String, Object> inputSchema,
        Map<String, Object> outputSchema,
        Integer version,
        ScriptScope scope,
        String repositoryId,
        String repositoryScriptId,
        String repositoryVersion,
        String sourcePath,
        String sourceCommit,
        String sourceDigest,
        LocalDateTime sourceSyncedAt,
        boolean dirty,
        boolean editable,
        String owner,
        String description,
        List<String> tags,
        List<ScriptDependency> scriptDependencies,
        List<PluginDependency> pluginDependencies,
        List<AiDependency> aiDependencies,
        ScriptPublishedRevisionView published,
        ScriptPublicationView publication,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
