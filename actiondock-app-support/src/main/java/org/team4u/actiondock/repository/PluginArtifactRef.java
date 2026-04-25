package org.team4u.actiondock.repository;

public record PluginArtifactRef(
        String uri,
        String sha256,
        String fileName,
        Long size
) {
}
