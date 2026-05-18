package org.team4u.actiondock.repository;

public record PluginArtifact(
        String fileName,
        byte[] content
) {
}
