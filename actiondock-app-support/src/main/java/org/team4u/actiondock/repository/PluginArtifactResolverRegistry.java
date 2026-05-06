package org.team4u.actiondock.repository;

import org.team4u.actiondock.shared.NormalizeUtils;

import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;


public class PluginArtifactResolverRegistry {
    private final Map<String, PluginArtifactResolver> resolversByScheme;

    public PluginArtifactResolverRegistry(List<PluginArtifactResolver> resolvers) {
        this.resolversByScheme = new HashMap<>();
        for (PluginArtifactResolver resolver : NormalizeUtils.nullSafeList(resolvers)) {
            for (String scheme : resolver.supportedSchemes()) {
                if (NormalizeUtils.isNotBlank(scheme)) {
                    resolversByScheme.put(scheme.toLowerCase(Locale.ROOT), resolver);
                }
            }
        }
    }

    public PluginArtifact resolve(PluginArtifactRef artifact, PluginArtifactContext context) {
        if (artifact == null || NormalizeUtils.isBlank(artifact.uri())) {
            throw new IllegalArgumentException("插件 artifact.uri 不能为空");
        }
        URI uri = URI.create(artifact.uri());
        String scheme = uri.getScheme();
        if (NormalizeUtils.isBlank(scheme)) {
            throw new IllegalArgumentException("插件 artifact.uri 缺少协议: " + artifact.uri());
        }
        PluginArtifactResolver resolver = resolversByScheme.get(scheme.toLowerCase(Locale.ROOT));
        if (resolver == null) {
            throw new IllegalArgumentException("不支持的插件 artifact 协议: " + scheme);
        }
        return resolver.resolve(artifact, context);
    }
}
