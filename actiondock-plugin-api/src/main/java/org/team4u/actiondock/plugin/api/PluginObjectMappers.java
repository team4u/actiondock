package org.team4u.actiondock.plugin.api;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 插件模块共享的 {@link ObjectMapper} 实例。
 *
 * @author jay.wu
 */
public final class PluginObjectMappers {
    public static final ObjectMapper DEFAULT = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private PluginObjectMappers() {
    }
}
