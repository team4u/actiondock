package org.team4u.actiondock.web.script;

import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptType;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public record ScriptPublishedRevisionView(
        String scriptId,
        String revisionId,
        Integer version,
        LocalDateTime publishedAt,
        String name,
        ScriptType type,
        ScriptPackaging packaging,
        String source,
        String pythonRequirements,
        Map<String, Object> inputSchema,
        Map<String, Object> outputSchema,
        String owner,
        String description,
        List<String> tags,
        List<ScriptDependency> scriptDependencies,
        List<PluginDependency> pluginDependencies,
        List<AiDependency> aiDependencies
) {
}
