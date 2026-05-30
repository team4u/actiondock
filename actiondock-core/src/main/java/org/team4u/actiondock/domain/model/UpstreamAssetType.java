package org.team4u.actiondock.domain.model;

/**
 * 上游资产类型，标识仓库中资产的具体类型。
 * <p>
 * 用于区分不同类型的可分发资产，如脚本和 Webhook。
 *
 * @author jay.wu
 */
public enum UpstreamAssetType {
    /** 脚本资产 */
    SCRIPT,
    /** Webhook 资产 */
    WEBHOOK,
    /** Playbook 资产 */
    PLAYBOOK
}
