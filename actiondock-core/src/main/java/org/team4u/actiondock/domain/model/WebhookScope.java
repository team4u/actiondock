package org.team4u.actiondock.domain.model;

/**
 * Webhook 作用域枚举。
 * <p>
 * 定义 Webhook 的可见性范围：个人作用域仅对创建者可见，仓库作用域对仓库内所有用户共享。
 *
 * @author jay.wu
 */
public enum WebhookScope {
    /** 个人作用域，仅创建者可见 */
    PERSONAL,
    /** 仓库作用域，仓库内共享 */
    REPOSITORY
}
