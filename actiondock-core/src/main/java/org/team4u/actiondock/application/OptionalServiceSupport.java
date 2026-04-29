package org.team4u.actiondock.application;

/**
 * 可选服务基类，封装 enabled 标志和 ensureEnabled() 检查逻辑。
 * <p>
 * 子类通过无参构造创建 disabled 单例，通过带参构造创建 enabled 实例。
 *
 * @author jay.wu
 */
public abstract class OptionalServiceSupport {
    private final boolean enabled;

    protected OptionalServiceSupport() {
        this.enabled = false;
    }

    protected OptionalServiceSupport(boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * 确保服务已启用，未启用时抛出异常。
     *
     * @throws IllegalStateException 如果服务未启用
     */
    protected void ensureEnabled() {
        if (!enabled) {
            throw new IllegalStateException(serviceName() + "未启用");
        }
    }

    /**
     * 返回服务名称，用于异常消息。
     */
    protected abstract String serviceName();

    public boolean isEnabled() {
        return enabled;
    }
}
