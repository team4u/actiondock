package org.team4u.actiondock.plugin.api;

/**
 * 插件运行时异常，封装插件执行过程中的非受检错误。
 *
 * @author jay.wu
 */
public class PluginRuntimeException extends RuntimeException {
    public PluginRuntimeException(String message) {
        super(message);
    }

    public PluginRuntimeException(String message, Throwable cause) {
        super(message, cause);
    }
}
