package org.team4u.actiondock.repository;

import java.util.Set;

public interface PluginArtifactResolver {
    Set<String> supportedSchemes();

    PluginArtifact resolve(PluginArtifactRef artifact, PluginArtifactContext context);
}
